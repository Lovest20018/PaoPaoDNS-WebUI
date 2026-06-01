"""
PaoPaoDNS Web UI Backend
Reads/writes /data directory files only.
No Docker socket, no Docker CLI, no container control.
Runs as a sidecar container sharing the /data volume with PaoPaoDNS.
"""

import os
import shutil
import re
import hmac
from flask import Flask, jsonify, request, send_from_directory

DATA_DIR = os.environ.get("DATA_DIR", "/data")
WEB_UI_TOKEN = os.environ.get("WEB_UI_TOKEN", "")
WEB_UI_ALLOW_NO_AUTH = os.environ.get("WEB_UI_ALLOW_NO_AUTH", "false").lower() == "true"

# Max upload size: 2 MB
MAX_CONTENT_LENGTH = 2 * 1024 * 1024

# Per-file size limits (bytes)
FILE_SIZE_LIMITS = {
    "custom_env.ini": 256 * 1024,
    "custom_mod.yaml": 512 * 1024,
    "unbound_custom.conf": 512 * 1024,
    # Default for list files
    "_default": 2 * 1024 * 1024,
}

# Sensitive key patterns to mask in /api/status
SENSITIVE_KEY_PATTERNS = re.compile(r"(TOKEN|PASSWORD|SECRET|KEY|PASS)", re.IGNORECASE)

# Runtime env keys that affect reload status. custom_env.ini values override these.
RUNTIME_ENV_KEYS = {
    "CNAUTO",
    "CUSTOM_FORWARD",
    "RULES_TTL",
    "USE_MARK_DATA",
    "CN_TRACKER",
    "IPV6",
    "CNFALL",
    "TZ",
}

app = Flask(__name__, static_folder="./dist", static_url_path="/")
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH


# Files that auto-reload via inotifywait in PaoPaoDNS (unconditional)
UNCONDITIONAL_AUTO_RELOAD = {
    "custom_env.ini",
    "force_dnscrypt_list.txt",
    "force_recurse_list.txt",
}

# Files that auto-reload only when specific env conditions are met
CONDITIONAL_AUTO_RELOAD = {
    "force_forward_list.txt": {"CNAUTO": "yes", "_needs_custom_forward": True},
    "force_ttl_rules.txt": {"CNAUTO": "yes", "_needs_rules_ttl": True},
    "custom_cn_mark.txt": {"CNAUTO": "yes", "USE_MARK_DATA": "yes"},
    "trackerslist.txt": {"CNAUTO": "yes", "CN_TRACKER": "yes"},
}

# Files that require reload.sh or container restart
RELOAD_REQUIRED_FILES = {"custom_mod.yaml"}
RESTART_REQUIRED_FILES = {"unbound_custom.conf"}

ALLOWED_FILES = (
    UNCONDITIONAL_AUTO_RELOAD
    | set(CONDITIONAL_AUTO_RELOAD.keys())
    | RELOAD_REQUIRED_FILES
    | RESTART_REQUIRED_FILES
)


def _check_auth() -> bool:
    """Return True if request is authenticated."""
    if not WEB_UI_TOKEN:
        return WEB_UI_ALLOW_NO_AUTH
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and hmac.compare_digest(auth[7:], WEB_UI_TOKEN):
        return True
    return False


def _check_file_condition(filename: str, env: dict) -> tuple[bool, str]:
    """Check if a file is actually watched by PaoPaoDNS given current env."""
    if filename in UNCONDITIONAL_AUTO_RELOAD:
        return True, ""
    if filename in CONDITIONAL_AUTO_RELOAD:
        conditions = CONDITIONAL_AUTO_RELOAD[filename]
        for key, expected in conditions.items():
            if key == "_needs_custom_forward":
                val = env.get("CUSTOM_FORWARD", "")
                if not val or ":" not in val:
                    return False, "需要配置 CUSTOM_FORWARD (含端口)"
                continue
            if key == "_needs_rules_ttl":
                try:
                    ttl = int(env.get("RULES_TTL", "0"))
                except (ValueError, TypeError):
                    ttl = 0
                if ttl <= 0:
                    return False, "需要 RULES_TTL > 0"
                continue
            actual = env.get(key, "")
            if actual.lower() != expected.lower():
                return False, f"需要 {key}={expected}"
        return True, ""
    return False, ""


def _file_reload_info(filename: str, env: dict | None = None) -> dict:
    """Return reload behavior info for a file, considering current env."""
    if env is None:
        env = _runtime_env()

    if filename in UNCONDITIONAL_AUTO_RELOAD:
        return {
            "auto_reload": True,
            "requires_reload": False,
            "requires_restart": False,
            "watched_now": True,
            "condition": "",
        }

    if filename in CONDITIONAL_AUTO_RELOAD:
        watched, cond = _check_file_condition(filename, env)
        return {
            "auto_reload": True,
            "requires_reload": False,
            "requires_restart": False,
            "watched_now": watched,
            "condition": cond,
        }

    if filename in RELOAD_REQUIRED_FILES:
        return {
            "auto_reload": False,
            "requires_reload": True,
            "requires_restart": False,
            "watched_now": False,
            "condition": "需在容器内执行 reload.sh",
        }

    if filename in RESTART_REQUIRED_FILES:
        return {
            "auto_reload": False,
            "requires_reload": False,
            "requires_restart": True,
            "watched_now": False,
            "condition": "需重启容器",
        }

    return {
        "auto_reload": False,
        "requires_reload": False,
        "requires_restart": False,
        "watched_now": False,
        "condition": "",
    }


def _mask_env(env: dict) -> dict:
    """Mask sensitive values in env dict for /api/status."""
    masked = {}
    for key, value in env.items():
        if SENSITIVE_KEY_PATTERNS.search(key):
            masked[key] = "***" if value else ""
        else:
            masked[key] = value
    return masked


def _safe_path(filename: str) -> str | None:
    """Prevent path traversal, only allow known filenames."""
    if filename not in ALLOWED_FILES:
        return None
    return os.path.join(DATA_DIR, filename)


def _read_file(filename: str) -> tuple[str | None, int]:
    """Read a file from /data. Returns (content, status_code)."""
    path = _safe_path(filename)
    if path is None:
        return None, 403
    if not os.path.exists(path):
        return "", 404
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            return f.read(), 200
    except Exception:
        return None, 500


def _atomic_write(filename: str, content: str) -> tuple[bool, str]:
    """Write content in-place with .bak backup.

    PaoPaoDNS watches individual paths with inotify. Replacing the file by
    rename can be missed by older event masks, so write/truncate the target
    path directly while keeping a best-effort backup.
    """
    path = _safe_path(filename)
    if path is None:
        return False, "File not allowed"

    # Check per-file size limit
    limit = FILE_SIZE_LIMITS.get(filename, FILE_SIZE_LIMITS["_default"])
    if len(content.encode("utf-8")) > limit:
        return False, f"Content exceeds size limit ({limit // 1024}KB)"

    try:
        dir_name = os.path.dirname(path)
        os.makedirs(dir_name, exist_ok=True)

        # Backup existing file via copy (do NOT move — avoids missing-file window)
        if os.path.exists(path):
            try:
                shutil.copy2(path, path + ".bak")
            except Exception:
                pass  # Non-fatal: backup failure shouldn't block write

        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
        return True, ""

    except Exception as e:
        return False, str(e)


def _parse_env_from_custom_ini() -> dict:
    """Parse custom_env.ini to get runtime env overrides."""
    result = {}
    path = os.path.join(DATA_DIR, "custom_env.ini")
    if not os.path.exists(path):
        return result
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                match = re.match(r'^([_a-zA-Z0-9]+)="(.*)"$', line)
                if match:
                    result[match.group(1)] = match.group(2)
    except Exception:
        pass
    return result


def _runtime_env() -> dict:
    """Return env values relevant to reload logic.

    The Web UI sidecar cannot inspect another container's environment unless
    values are mirrored into this container. custom_env.ini is still authoritative
    for runtime overrides because PaoPaoDNS reloads it before restarting mosdns.
    """
    env = {key: os.environ.get(key, "") for key in RUNTIME_ENV_KEYS if key in os.environ}
    env.update(_parse_env_from_custom_ini())
    return env


# ---- Error Handlers ----


@app.errorhandler(413)
def request_entity_too_large(e):
    return jsonify({"error": "Request too large (max 2MB)"}), 413


# ---- API Routes ----


@app.before_request
def auth_middleware():
    """Check authentication on all /api/ routes."""
    if request.path.startswith("/api/"):
        if not _check_auth():
            return jsonify({"error": "Unauthorized"}), 401


@app.route("/api/status")
def api_status():
    """Get /data directory status and file info."""
    data_writable = os.access(DATA_DIR, os.W_OK)
    data_readable = os.access(DATA_DIR, os.R_OK)

    # Runtime env plus custom_env.ini overrides for reload status.
    env = _runtime_env()

    # Check which key files exist
    key_files = list(ALLOWED_FILES) + [
        "redis_dns_v2.rdb",
        "Country-only-cn-private.mmdb",
        "global_mark.dat",
    ]
    files_exist = {}
    for f in key_files:
        files_exist[f] = os.path.exists(os.path.join(DATA_DIR, f))

    # Add reload info for each file (dynamic based on env)
    files_info = {}
    for f in ALLOWED_FILES:
        files_info[f] = {
            "exists": files_exist.get(f, False),
            **_file_reload_info(f, env),
        }

    return jsonify({
        "data_dir": DATA_DIR,
        "data_readable": data_readable,
        "data_writable": data_writable,
        "auth_enabled": bool(WEB_UI_TOKEN),
        "env": _mask_env(env),
        "files": files_exist,
        "files_info": files_info,
    })


@app.route("/api/env")
def api_env():
    """Get runtime environment overrides from custom_env.ini."""
    return jsonify(_parse_env_from_custom_ini())


@app.route("/api/file/<filename>", methods=["GET"])
def api_read_file(filename):
    """Read a configuration file from /data."""
    content, status = _read_file(filename)
    if status == 403:
        return jsonify({"error": "File not allowed"}), 403
    if status == 404:
        return jsonify({"filename": filename, "content": "", "error": "File not found"}), 404
    if status == 500:
        return jsonify({"error": "Failed to read file"}), 500
    env = _runtime_env()
    return jsonify({
        "filename": filename,
        "content": content,
        **_file_reload_info(filename, env),
    })


@app.route("/api/file/<filename>", methods=["PUT"])
def api_write_file(filename):
    """Write a configuration file to /data in-place with backup."""
    data = request.get_json()
    if not data or "content" not in data:
        return jsonify({"error": "Missing content"}), 400

    if _safe_path(filename) is None:
        return jsonify({"error": "File not allowed"}), 403

    success, err = _atomic_write(filename, data["content"])
    if success:
        env = _runtime_env()
        reload_info = _file_reload_info(filename, env)
        return jsonify({
            "message": "File saved successfully",
            "filename": filename,
            **reload_info,
        })
    return jsonify({"error": f"Failed to write file: {err}"}), 500


@app.route("/api/health")
def api_health():
    """Health check endpoint."""
    return jsonify({"status": "ok", "data_dir": DATA_DIR})


# ---- Serve React SPA ----


@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_spa(path):
    """Serve the React SPA."""
    if path and os.path.exists(os.path.join(app.static_folder, path)):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080, debug=False)
