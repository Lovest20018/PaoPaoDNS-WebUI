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
import secrets
import socket
import struct
import threading
import time
from urllib.parse import urlparse
from flask import Flask, jsonify, request, send_from_directory


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, str(default)))
    except (TypeError, ValueError):
        return default


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.environ.get(key, str(default)))
    except (TypeError, ValueError):
        return default


DATA_DIR = os.environ.get("DATA_DIR", "/data")
WEB_UI_TOKEN = os.environ.get("WEB_UI_TOKEN", "")
WEB_UI_ALLOW_NO_AUTH = os.environ.get("WEB_UI_ALLOW_NO_AUTH", "false").lower() == "true"
DNS_TEST_SERVER = os.environ.get("DNS_TEST_SERVER", "paopaodns")
DNS_TEST_PORT = _env_int("DNS_TEST_PORT", 53)
DNS_TEST_TIMEOUT = _env_float("DNS_TEST_TIMEOUT", 3)

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
WRITE_LOCKS = {filename: threading.Lock() for filename in ALLOWED_FILES}

DOMAIN_RULE_FILES = {
    "force_forward_list.txt",
    "force_dnscrypt_list.txt",
    "force_recurse_list.txt",
    "custom_cn_mark.txt",
}
DOMAIN_RULE_PREFIXES = ("domain:", "full:", "regexp:", "keyword:")
TRACKER_URL_SCHEMES = {"http", "https", "udp", "ws", "wss"}
DNS_RECORD_TYPES = {"A": 1, "AAAA": 28, "CNAME": 5}
DNS_TYPE_NAMES = {value: key for key, value in DNS_RECORD_TYPES.items()}
DNS_TYPE_NAMES.update({2: "NS", 12: "PTR", 15: "MX", 16: "TXT", 65: "HTTPS"})
DNS_RCODE_NAMES = {
    0: "NOERROR",
    1: "FORMERR",
    2: "SERVFAIL",
    3: "NXDOMAIN",
    4: "NOTIMP",
    5: "REFUSED",
}
HEALTH_CHECK_DOMAINS = {
    "cn": "www.baidu.com",
    "non_cn": "www.google.com",
}


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


def _has_control_chars(value: str) -> bool:
    """Return True for embedded control chars except common whitespace."""
    return any(ord(ch) < 32 and ch not in "\n\r\t" for ch in value)


def _validate_custom_env(content: str) -> tuple[bool, str]:
    """Validate custom_env.ini assignment lines."""
    assignment_re = re.compile(r'^[_a-zA-Z0-9]+=".*"$')
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if not assignment_re.match(stripped):
            return False, f'第 {line_no} 行格式错误，应为 KEY="VALUE" 或注释'
    return True, ""


def _validate_custom_mod_yaml(content: str) -> tuple[bool, str]:
    """Validate custom_mod.yaml syntax without enforcing every upstream shape."""
    try:
        import yaml

        parsed = yaml.safe_load(content) if content.strip() else None
    except ImportError:
        return False, "缺少 PyYAML 依赖，无法校验 YAML"
    except yaml.YAMLError as e:
        return False, f"YAML 语法错误: {e}"

    if parsed is not None and not isinstance(parsed, dict):
        return False, "YAML 顶层应为对象"
    return True, ""


def _validate_domain_rule_list(filename: str, content: str) -> tuple[bool, str]:
    """Validate mosdns-style domain rule lists while allowing bare domains."""
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _has_control_chars(stripped):
            return False, f"第 {line_no} 行包含不可见控制字符"

        prefix = next((p for p in DOMAIN_RULE_PREFIXES if stripped.startswith(p)), "")
        if prefix:
            value = stripped[len(prefix):].strip()
            if not value:
                return False, f"第 {line_no} 行缺少规则内容"
            if prefix != "regexp:" and re.search(r"\s", value):
                return False, f"第 {line_no} 行规则内容不能包含空白字符"
            if prefix != "regexp:" and re.search(r"""["'`$;&<>]""", value):
                return False, f"第 {line_no} 行包含不支持的特殊字符"
            continue

        if re.search(r"\s", stripped):
            return False, f"第 {line_no} 行域名规则不能包含空白字符"
        if re.search(r"""["'`$;&<>]""", stripped):
            return False, f"第 {line_no} 行包含不支持的特殊字符"

    return True, ""


def _validate_ttl_rules(content: str) -> tuple[bool, str]:
    """Validate force_ttl_rules.txt with @, @@, or @@@ separators."""
    rule_re = re.compile(r"^[^@\s]+(@@@|@@|@)[^@\s]+$")
    for line_no, line in enumerate(content.splitlines(), 1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if _has_control_chars(stripped):
            return False, f"第 {line_no} 行包含不可见控制字符"
        if re.search(r"""["'`$;&<>|]""", stripped):
            return False, f"第 {line_no} 行包含不支持的特殊字符"
        if not rule_re.match(stripped):
            return False, f"第 {line_no} 行 TTL 规则格式错误，应包含 @、@@ 或 @@@"
    return True, ""


def _validate_tracker_list(content: str) -> tuple[bool, str]:
    """Validate trackerslist.txt as one tracker URL per line."""
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
    """Validate file content before writing to /data."""
    if "\x00" in content:
        return False, "内容包含 NUL 字符"

    if filename == "custom_env.ini":
        return _validate_custom_env(content)
    if filename == "custom_mod.yaml":
        return _validate_custom_mod_yaml(content)
    if filename == "force_ttl_rules.txt":
        return _validate_ttl_rules(content)
    if filename in DOMAIN_RULE_FILES:
        return _validate_domain_rule_list(filename, content)
    if filename == "trackerslist.txt":
        return _validate_tracker_list(content)
    return True, ""


def _content_size_error(filename: str, content: str) -> str:
    """Return an error when content exceeds the per-file size limit."""
    limit = FILE_SIZE_LIMITS.get(filename, FILE_SIZE_LIMITS["_default"])
    if len(content.encode("utf-8")) > limit:
        return f"Content exceeds size limit ({limit // 1024}KB)"
    return ""


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

    lock = WRITE_LOCKS[filename]
    try:
        with lock:
            dir_name = os.path.dirname(path)
            os.makedirs(dir_name, exist_ok=True)

            existed_before = os.path.exists(path)
            read_ok = False
            if existed_before:
                try:
                    with open(path, "rb") as original:
                        original_bytes = original.read()
                    read_ok = True
                except Exception:
                    original_bytes = b""

                # Backup existing file via copy (do NOT move — avoids missing-file window)
                try:
                    shutil.copy2(path, path + ".bak")
                except Exception:
                    pass  # Non-fatal: backup failure shouldn't block write

            try:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(content)
                    f.flush()
                    os.fsync(f.fileno())
            except Exception:
                _restore_failed_write(path, existed_before, original_bytes, read_ok)
                raise
            return True, ""

    except Exception as e:
        return False, str(e)


def _restore_failed_write(path: str, existed_before: bool, original_bytes: bytes, read_ok: bool = True) -> None:
    """Best-effort rollback when direct truncate/write fails.

    Priority: in-memory bytes (if read succeeded) → .bak copy → last resort: leave as-is.
    """
    try:
        if existed_before and read_ok and original_bytes:
            with open(path, "wb") as f:
                f.write(original_bytes)
                f.flush()
                os.fsync(f.fileno())
            return
        if existed_before and os.path.exists(path + ".bak"):
            shutil.copy2(path + ".bak", path)
            return
        if not existed_before and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


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


def _normalize_domain(domain: str) -> tuple[str | None, str]:
    """Validate and normalize a user-provided domain to IDNA ASCII."""
    if not isinstance(domain, str):
        return None, "Domain must be a string"

    value = domain.strip().rstrip(".")
    if not value:
        return None, "Domain is required"

    try:
        ascii_domain = value.encode("idna").decode("ascii")
    except UnicodeError:
        return None, "Invalid domain"

    if len(ascii_domain) > 253:
        return None, "Domain is too long"

    labels = ascii_domain.split(".")
    label_re = re.compile(r"^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$")
    for label in labels:
        if not label or len(label) > 63 or not label_re.match(label):
            return None, "Invalid domain label"

    return ascii_domain, ""


def _normalize_record_type(record_type: str) -> tuple[str | None, str]:
    value = (record_type or "A").strip().upper()
    if value not in DNS_RECORD_TYPES:
        return None, f"Unsupported record type: {value}"
    return value, ""


def _normalize_dns_server(server: str) -> tuple[str | None, str]:
    value = (server or DNS_TEST_SERVER).strip()
    if not value:
        return None, "DNS server is required"
    if len(value) > 253 or re.search(r"\s", value) or _has_control_chars(value):
        return None, "Invalid DNS server"
    return value, ""


def _normalize_dns_port(port) -> tuple[int | None, str]:
    try:
        value = int(port if port not in (None, "") else DNS_TEST_PORT)
    except (TypeError, ValueError):
        return None, "Invalid DNS port"
    if value < 1 or value > 65535:
        return None, "Invalid DNS port"
    return value, ""


def _encode_dns_name(domain: str) -> bytes:
    parts = []
    for label in domain.split("."):
        raw = label.encode("ascii")
        parts.append(bytes([len(raw)]))
        parts.append(raw)
    parts.append(b"\x00")
    return b"".join(parts)


def _read_dns_name(packet: bytes, offset: int, depth: int = 0) -> tuple[str, int]:
    """Read a possibly-compressed DNS name from a packet."""
    if depth > 10:
        raise ValueError("DNS name compression pointer loop")

    labels = []
    cursor = offset
    jumped = False
    next_offset = offset

    while True:
        if cursor >= len(packet):
            raise ValueError("DNS name exceeds packet length")

        length = packet[cursor]
        if length == 0:
            cursor += 1
            if not jumped:
                next_offset = cursor
            break

        if length & 0xC0 == 0xC0:
            if cursor + 1 >= len(packet):
                raise ValueError("Invalid DNS compression pointer")
            pointer = ((length & 0x3F) << 8) | packet[cursor + 1]
            if pointer >= len(packet):
                raise ValueError("DNS compression pointer out of range")
            if not jumped:
                next_offset = cursor + 2
            cursor = pointer
            jumped = True
            depth += 1
            if depth > 10:
                raise ValueError("DNS name compression pointer loop")
            continue

        if length & 0xC0:
            raise ValueError("Unsupported DNS label type")

        cursor += 1
        if cursor + length > len(packet):
            raise ValueError("DNS label exceeds packet length")
        labels.append(packet[cursor:cursor + length].decode("ascii", errors="replace"))
        cursor += length

    return ".".join(labels), next_offset


def _parse_dns_response(packet: bytes, query_id: int) -> dict:
    """Parse enough DNS response data for the diagnostics UI."""
    if len(packet) < 12:
        raise ValueError("DNS response too short")

    response_id, flags, qdcount, ancount, nscount, arcount = struct.unpack("!HHHHHH", packet[:12])
    if response_id != query_id:
        raise ValueError("DNS response ID mismatch")

    offset = 12
    for _ in range(qdcount):
        _, offset = _read_dns_name(packet, offset)
        if offset + 4 > len(packet):
            raise ValueError("DNS question exceeds packet length")
        offset += 4

    answers = []
    for _ in range(ancount):
        name, offset = _read_dns_name(packet, offset)
        if offset + 10 > len(packet):
            raise ValueError("DNS answer exceeds packet length")

        rtype, rclass, ttl, rdlength = struct.unpack("!HHIH", packet[offset:offset + 10])
        offset += 10
        rdata_offset = offset
        rdata_end = offset + rdlength
        if rdata_end > len(packet):
            raise ValueError("DNS answer data exceeds packet length")

        rdata = packet[rdata_offset:rdata_end]
        record_type = DNS_TYPE_NAMES.get(rtype, f"TYPE{rtype}")
        value = rdata.hex()
        if rtype == DNS_RECORD_TYPES["A"] and rdlength == 4:
            value = socket.inet_ntop(socket.AF_INET, rdata)
        elif rtype == DNS_RECORD_TYPES["AAAA"] and rdlength == 16:
            value = socket.inet_ntop(socket.AF_INET6, rdata)
        elif rtype in (DNS_RECORD_TYPES["CNAME"], 2, 12):
            value, _ = _read_dns_name(packet, rdata_offset)
        elif rtype == 15 and rdlength >= 3:
            preference = struct.unpack("!H", rdata[:2])[0]
            exchange, _ = _read_dns_name(packet, rdata_offset + 2)
            value = f"{preference} {exchange}"
        elif rtype == 16 and rdlength:
            text_len = rdata[0]
            value = rdata[1:1 + text_len].decode("utf-8", errors="replace")

        answers.append({
            "name": name,
            "type": record_type,
            "ttl": ttl,
            "value": value,
            "class": rclass,
        })
        offset = rdata_end

    rcode = flags & 0x000F
    return {
        "answers": answers,
        "rcode": DNS_RCODE_NAMES.get(rcode, f"RCODE{rcode}"),
        "rcode_value": rcode,
        "truncated": bool(flags & 0x0200),
        "authoritative": bool(flags & 0x0400),
        "recursion_available": bool(flags & 0x0080),
        "counts": {
            "questions": qdcount,
            "answers": ancount,
            "authority": nscount,
            "additional": arcount,
        },
    }


def _dns_lookup(domain: str, record_type: str = "A", server: str | None = None, port: int | None = None) -> dict:
    """Run a small UDP DNS query without shelling out to dig."""
    normalized_domain, domain_err = _normalize_domain(domain)
    normalized_type, type_err = _normalize_record_type(record_type)
    normalized_server, server_err = _normalize_dns_server(server or DNS_TEST_SERVER)
    normalized_port, port_err = _normalize_dns_port(port)
    error = domain_err or type_err or server_err or port_err
    if error:
        return {
            "available": False,
            "domain": domain,
            "record_type": record_type,
            "server": server or DNS_TEST_SERVER,
            "port": port or DNS_TEST_PORT,
            "error": error,
        }

    query_id = secrets.randbits(16)
    query = (
        struct.pack("!HHHHHH", query_id, 0x0100, 1, 0, 0, 0)
        + _encode_dns_name(normalized_domain)
        + struct.pack("!HH", DNS_RECORD_TYPES[normalized_type], 1)
    )

    started = time.monotonic()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(DNS_TEST_TIMEOUT)
            sock.sendto(query, (normalized_server, normalized_port))
            response, _ = sock.recvfrom(4096)
        elapsed_ms = round((time.monotonic() - started) * 1000, 1)
        parsed = _parse_dns_response(response, query_id)
        answers = parsed["answers"]
        matched_values = [
            answer["value"]
            for answer in answers
            if answer["type"] in {normalized_type, "CNAME"}
        ]
        return {
            "available": parsed["rcode_value"] == 0,
            "domain": normalized_domain,
            "record_type": normalized_type,
            "server": normalized_server,
            "port": normalized_port,
            "elapsed_ms": elapsed_ms,
            "results": matched_values,
            **parsed,
        }
    except Exception as e:
        elapsed_ms = round((time.monotonic() - started) * 1000, 1)
        return {
            "available": False,
            "domain": normalized_domain,
            "record_type": normalized_type,
            "server": normalized_server,
            "port": normalized_port,
            "elapsed_ms": elapsed_ms,
            "answers": [],
            "results": [],
            "error": str(e),
        }


def _run_health_check(server: str | None = None, port: int | None = None) -> dict:
    """Run a small CN/non-CN DNS health check."""
    normalized_server, server_err = _normalize_dns_server(server or DNS_TEST_SERVER)
    normalized_port, port_err = _normalize_dns_port(port)
    if server_err or port_err:
        error = server_err or port_err
        return {
            "pass": False,
            "server": server or DNS_TEST_SERVER,
            "port": port or DNS_TEST_PORT,
            "error": error,
            "tests": {},
        }

    tests = {}
    for category, domain in HEALTH_CHECK_DOMAINS.items():
        result = _dns_lookup(domain, "A", normalized_server, normalized_port)
        tests[category] = {
            "domain": domain,
            "resolved": bool(result.get("available") and result.get("answers")),
            "result": result,
        }

    return {
        "pass": all(item["resolved"] for item in tests.values()),
        "server": normalized_server,
        "port": normalized_port,
        "tests": tests,
    }


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

    content = data["content"]
    if not isinstance(content, str):
        return jsonify({"error": "Content must be a string"}), 400

    valid, err = _validate_file_content(filename, content)
    if not valid:
        return jsonify({"error": f"Content validation failed: {err}"}), 400

    size_err = _content_size_error(filename, content)
    if size_err:
        return jsonify({"error": size_err}), 413

    success, err = _atomic_write(filename, content)
    if success:
        env = _runtime_env()
        reload_info = _file_reload_info(filename, env)
        return jsonify({
            "message": "File saved successfully",
            "filename": filename,
            **reload_info,
        })
    return jsonify({"error": f"Failed to write file: {err}"}), 500


@app.route("/api/dns-test", methods=["POST"])
def api_dns_test():
    """Run a DNS lookup against the configured PaoPaoDNS service."""
    data = request.get_json(silent=True) or {}
    domain = data.get("domain", "")
    record_type = data.get("record_type", "A")
    server = data.get("server") or DNS_TEST_SERVER
    port = data.get("port") or DNS_TEST_PORT

    normalized_domain, domain_err = _normalize_domain(domain)
    normalized_type, type_err = _normalize_record_type(record_type)
    normalized_server, server_err = _normalize_dns_server(server)
    normalized_port, port_err = _normalize_dns_port(port)
    error = domain_err or type_err or server_err or port_err
    if error:
        return jsonify({"error": error}), 400

    return jsonify(_dns_lookup(normalized_domain, normalized_type, normalized_server, normalized_port))


@app.route("/api/health-check")
def api_health_check():
    """Run a small CN/non-CN DNS health check."""
    server = request.args.get("server") or DNS_TEST_SERVER
    port = request.args.get("port") or DNS_TEST_PORT

    normalized_server, server_err = _normalize_dns_server(server)
    normalized_port, port_err = _normalize_dns_port(port)
    error = server_err or port_err
    if error:
        return jsonify({"error": error}), 400

    return jsonify(_run_health_check(normalized_server, normalized_port))


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
