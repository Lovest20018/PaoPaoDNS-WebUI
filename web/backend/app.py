"""Lightweight PaoPaoDNS configuration-file editor backend."""

import hmac
import ipaddress
import logging
import os
import re
import shutil
import threading
from urllib.parse import urlparse

from flask import Flask, jsonify, request, send_from_directory


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger(__name__)


def _load_dotenv_file(path) -> None:
    """Load simple KEY=VALUE pairs without overriding the process environment."""
    if not os.path.exists(path):
        return
    key_re = re.compile(r"^[_a-zA-Z][_a-zA-Z0-9]*$")
    try:
        with open(path, "r", encoding="utf-8") as env_file:
            for line in env_file:
                stripped = line.strip()
                if not stripped or stripped.startswith("#"):
                    continue
                if stripped.startswith("export "):
                    stripped = stripped[7:].strip()
                if "=" not in stripped:
                    continue
                key, value = stripped.split("=", 1)
                key = key.strip()
                if not key_re.match(key):
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
                    value = value[1:-1]
                os.environ.setdefault(key, value)
    except OSError:
        logger.warning("Unable to read local .env file")


_load_dotenv_file(os.path.join(os.path.dirname(__file__), ".env"))

DATA_DIR = os.environ.get("DATA_DIR", "/data")
WEB_UI_TOKEN = os.environ.get("WEB_UI_TOKEN", "")
WEB_UI_ALLOW_NO_AUTH = os.environ.get("WEB_UI_ALLOW_NO_AUTH", "false").lower() == "true"
MAX_CONTENT_LENGTH = 2 * 1024 * 1024

FILE_SIZE_LIMITS = {
    "custom_env.ini": 256 * 1024,
    "custom_mod.yaml": 512 * 1024,
    "unbound_custom.conf": 512 * 1024,
    "_default": 2 * 1024 * 1024,
}

UNCONDITIONAL_AUTO_RELOAD = {
    "custom_env.ini",
    "force_dnscrypt_list.txt",
    "force_recurse_list.txt",
}
CONDITIONAL_AUTO_RELOAD = {
    "force_forward_list.txt": "启用 CNAUTO 和 CUSTOM_FORWARD 时自动加载",
    "force_ttl_rules.txt": "启用 CNAUTO 且 RULES_TTL 大于 0 时自动加载",
    "custom_cn_mark.txt": "启用 CNAUTO 和 USE_MARK_DATA 时自动加载",
    "trackerslist.txt": "启用 CNAUTO 和 CN_TRACKER 时自动加载",
}
RELOAD_REQUIRED_FILES = {"custom_mod.yaml"}
RESTART_REQUIRED_FILES = {"unbound_custom.conf"}
ALLOWED_FILES = (
    UNCONDITIONAL_AUTO_RELOAD
    | set(CONDITIONAL_AUTO_RELOAD)
    | RELOAD_REQUIRED_FILES
    | RESTART_REQUIRED_FILES
)

WRITE_LOCKS = {filename: threading.Lock() for filename in ALLOWED_FILES}
DOMAIN_RULE_FILES = {
    "force_forward_list.txt",
    "force_dnscrypt_list.txt",
    "force_recurse_list.txt",
    "custom_cn_mark.txt",
}
DOMAIN_RULE_PREFIXES = ("domain:", "full:", "regexp:", "keyword:")
TRACKER_URL_SCHEMES = {"http", "https", "udp", "ws", "wss"}

app = Flask(__name__, static_folder="./dist", static_url_path="/")
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


def _trusted_proxy_networks() -> list:
    networks = []
    for raw_value in os.environ.get("WEB_UI_TRUSTED_PROXIES", "").split(","):
        value = raw_value.strip()
        if not value:
            continue
        try:
            networks.append(ipaddress.ip_network(value, strict=False))
        except ValueError:
            logger.warning("Ignoring invalid trusted proxy entry: %s", value)
    return networks


def _is_trusted_proxy(ip: str | None) -> bool:
    if not ip:
        return False
    try:
        address = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(address in network for network in _trusted_proxy_networks())


def _client_ip() -> str:
    remote_addr = request.remote_addr or "unknown"
    if _is_trusted_proxy(remote_addr):
        forwarded_ip = request.headers.get("X-Forwarded-For", "").split(",", 1)[0].strip()
        if forwarded_ip:
            return forwarded_ip
    return remote_addr


def _check_auth() -> bool:
    if not WEB_UI_TOKEN:
        return WEB_UI_ALLOW_NO_AUTH
    auth = request.headers.get("Authorization", "")
    return auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], WEB_UI_TOKEN)


def _config_info(filename: str) -> dict:
    condition = CONDITIONAL_AUTO_RELOAD.get(filename, "")
    if filename in UNCONDITIONAL_AUTO_RELOAD:
        condition = "保存后由 PaoPaoDNS 自动加载"
    return {
        "filename": filename,
        "exists": os.path.exists(os.path.join(DATA_DIR, filename)),
        "auto_reload": filename in UNCONDITIONAL_AUTO_RELOAD or filename in CONDITIONAL_AUTO_RELOAD,
        "requires_reload": filename in RELOAD_REQUIRED_FILES,
        "requires_restart": filename in RESTART_REQUIRED_FILES,
        "condition": condition,
    }


def _safe_path(filename: str) -> str | None:
    return os.path.join(DATA_DIR, filename) if filename in ALLOWED_FILES else None


def _has_control_chars(value: str) -> bool:
    return any(ord(ch) < 32 and ch not in "\n\r\t" for ch in value)


def _validate_custom_env(content: str) -> tuple[bool, str]:
    assignment_re = re.compile(r'^[_a-zA-Z0-9]+=".*"$')
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not assignment_re.match(stripped):
            return False, f'第 {line_no} 行格式错误，应为 KEY="VALUE" 或注释'
    return True, ""


def _validate_custom_mod_yaml(content: str) -> tuple[bool, str]:
    try:
        import yaml
        parsed = yaml.safe_load(content) if content.strip() else None
    except ImportError:
        return False, "缺少 PyYAML 依赖，无法校验 YAML"
    except yaml.YAMLError as error:
        return False, f"YAML 语法错误: {error}"
    if parsed is not None and not isinstance(parsed, dict):
        return False, "YAML 顶层应为对象"
    return True, ""


def _validate_domain_rule_list(content: str) -> tuple[bool, str]:
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _has_control_chars(stripped):
            return False, f"第 {line_no} 行包含不可见控制字符"
        prefix = next((item for item in DOMAIN_RULE_PREFIXES if stripped.startswith(item)), "")
        value = stripped[len(prefix):].strip() if prefix else stripped
        if not value:
            return False, f"第 {line_no} 行缺少规则内容"
        if prefix != "regexp:" and re.search(r"\s", value):
            return False, f"第 {line_no} 行域名规则不能包含空白字符"
        if prefix != "regexp:" and re.search(r'''["'`$;&<>]''', value):
            return False, f"第 {line_no} 行包含不支持的特殊字符"
    return True, ""


def _validate_ttl_rules(content: str) -> tuple[bool, str]:
    rule_re = re.compile(r"^[^@\s]+(@@@|@@|@)[^@\s]+$")
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _has_control_chars(stripped):
            return False, f"第 {line_no} 行包含不可见控制字符"
        if re.search(r'''["'`$;&<>|]''', stripped):
            return False, f"第 {line_no} 行包含不支持的特殊字符"
        if not rule_re.match(stripped):
            return False, f"第 {line_no} 行 TTL 规则格式错误，应包含 @、@@ 或 @@@"
    return True, ""


def _validate_tracker_list(content: str) -> tuple[bool, str]:
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _has_control_chars(stripped):
            return False, f"第 {line_no} 行包含不可见控制字符"
        parsed = urlparse(stripped)
        if parsed.scheme.lower() not in TRACKER_URL_SCHEMES or not parsed.netloc:
            return False, f"第 {line_no} 行不是有效的 Tracker URL"
    return True, ""


def _validate_file_content(filename: str, content: str) -> tuple[bool, str]:
    if "\x00" in content:
        return False, "内容包含 NUL 字符"
    if filename == "custom_env.ini":
        return _validate_custom_env(content)
    if filename == "custom_mod.yaml":
        return _validate_custom_mod_yaml(content)
    if filename == "force_ttl_rules.txt":
        return _validate_ttl_rules(content)
    if filename in DOMAIN_RULE_FILES:
        return _validate_domain_rule_list(content)
    if filename == "trackerslist.txt":
        return _validate_tracker_list(content)
    return True, ""


def _content_size_error(filename: str, content: str) -> str:
    limit = FILE_SIZE_LIMITS.get(filename, FILE_SIZE_LIMITS["_default"])
    return f"Content exceeds size limit ({limit // 1024}KB)" if len(content.encode("utf-8")) > limit else ""


def _read_file(filename: str) -> tuple[str | None, int]:
    path = _safe_path(filename)
    if path is None:
        return None, 403
    if not os.path.exists(path):
        return "", 404
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as file:
            return file.read(), 200
    except OSError:
        return None, 500


def _restore_failed_write(path: str, existed_before: bool, original_bytes: bytes, read_ok: bool) -> None:
    try:
        if existed_before and read_ok:
            with open(path, "wb") as file:
                file.write(original_bytes)
                file.flush()
                os.fsync(file.fileno())
            return
        if existed_before and os.path.exists(path + ".bak"):
            shutil.copy2(path + ".bak", path)
            return
        if not existed_before and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def _atomic_write(filename: str, content: str) -> tuple[bool, str]:
    """Write in place so PaoPaoDNS's path-based inotify watcher sees the change."""
    path = _safe_path(filename)
    if path is None:
        return False, "File not allowed"
    size_error = _content_size_error(filename, content)
    if size_error:
        return False, size_error
    try:
        with WRITE_LOCKS[filename]:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            existed_before = os.path.exists(path)
            original_bytes = b""
            read_ok = False
            if existed_before:
                try:
                    with open(path, "rb") as original:
                        original_bytes = original.read()
                    read_ok = True
                except OSError:
                    pass
                try:
                    shutil.copy2(path, path + ".bak")
                except OSError:
                    pass
            try:
                with open(path, "w", encoding="utf-8") as file:
                    file.write(content)
                    file.flush()
                    os.fsync(file.fileno())
            except OSError:
                _restore_failed_write(path, existed_before, original_bytes, read_ok)
                raise
        return True, ""
    except OSError as error:
        return False, str(error)


@app.errorhandler(413)
def request_entity_too_large(_error):
    return jsonify({"error": "Request too large (max 2MB)"}), 413


@app.before_request
def auth_middleware():
    if request.path.startswith("/api/") and not _check_auth():
        logger.warning("Authentication failed from %s for %s %s", _client_ip(), request.method, request.path)
        return jsonify({"error": "Unauthorized"}), 401


@app.route("/api/status")
def api_status():
    return jsonify({
        "data_dir": DATA_DIR,
        "data_readable": os.access(DATA_DIR, os.R_OK),
        "data_writable": os.access(DATA_DIR, os.W_OK),
        "auth_enabled": bool(WEB_UI_TOKEN),
    })


@app.route("/api/configs")
def api_configs():
    return jsonify([_config_info(filename) for filename in sorted(ALLOWED_FILES)])


@app.route("/api/configs/<filename>", methods=["GET"])
def api_read_config(filename):
    content, status = _read_file(filename)
    if status == 403:
        return jsonify({"error": "File not allowed"}), 403
    if status == 500:
        return jsonify({"error": "Failed to read file"}), 500
    return jsonify({**_config_info(filename), "content": content or ""})


@app.route("/api/configs/<filename>", methods=["PUT"])
def api_write_config(filename):
    client_ip = _client_ip()
    data = request.get_json(silent=True)
    if not data or "content" not in data:
        return jsonify({"error": "Missing content"}), 400
    if _safe_path(filename) is None:
        logger.warning("Rejected write to disallowed file '%s' from %s", filename, client_ip)
        return jsonify({"error": "File not allowed"}), 403
    content = data["content"]
    if not isinstance(content, str):
        return jsonify({"error": "Content must be a string"}), 400
    content_size = len(content.encode("utf-8"))
    valid, validation_error = _validate_file_content(filename, content)
    if not valid:
        logger.warning("Validation failed for '%s' from %s: %s", filename, client_ip, validation_error)
        return jsonify({"error": f"Content validation failed: {validation_error}"}), 400
    size_error = _content_size_error(filename, content)
    if size_error:
        logger.warning("Size limit exceeded for '%s' from %s", filename, client_ip)
        return jsonify({"error": size_error}), 413
    success, write_error = _atomic_write(filename, content)
    if not success:
        logger.error("Failed to write '%s' from %s: %s", filename, client_ip, write_error)
        return jsonify({"error": f"Failed to write file: {write_error}"}), 500
    logger.info("Wrote '%s' (%s bytes) from %s", filename, content_size, client_ip)
    return jsonify({"message": "File saved successfully", **_config_info(filename)})


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    logger.info("PaoPaoDNS Config backend starting; data directory: %s", DATA_DIR)
    logger.info("Authentication: %s", "enabled" if WEB_UI_TOKEN else f"disabled (allow_no_auth={WEB_UI_ALLOW_NO_AUTH})")
    app.run(host="0.0.0.0", port=8080, debug=False)
