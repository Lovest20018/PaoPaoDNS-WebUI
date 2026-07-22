import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import app as backend


AUTH_HEADERS = {"Authorization": "Bearer test-token"}


@pytest.fixture
def client(monkeypatch, tmp_path):
    monkeypatch.setattr(backend, "DATA_DIR", str(tmp_path))
    monkeypatch.setattr(backend, "WEB_UI_TOKEN", "test-token")
    monkeypatch.setattr(backend, "WEB_UI_ALLOW_NO_AUTH", False)
    backend.app.config["TESTING"] = True
    with backend.app.test_client() as test_client:
        yield test_client


def put_config(client, filename: str, content, headers=None):
    return client.put(
        f"/api/configs/{filename}",
        json={"content": content},
        headers=headers or AUTH_HEADERS,
    )


def test_api_requires_auth(client):
    assert client.get("/api/status").status_code == 401
    assert client.get("/api/configs").status_code == 401


def test_status_is_limited_to_editor_capabilities(client):
    response = client.get("/api/status", headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.get_json() == {
        "auth_enabled": True,
        "data_dir": backend.DATA_DIR,
        "data_readable": True,
        "data_writable": True,
    }


def test_configs_lists_only_editable_files(client):
    response = client.get("/api/configs", headers=AUTH_HEADERS)
    assert response.status_code == 200
    configs = response.get_json()
    assert {item["filename"] for item in configs} == backend.ALLOWED_FILES
    assert all("auto_reload" in item for item in configs)


def test_missing_allowed_config_is_returned_as_empty(client):
    response = client.get("/api/configs/custom_env.ini", headers=AUTH_HEADERS)
    assert response.status_code == 200
    assert response.get_json()["content"] == ""
    assert response.get_json()["exists"] is False


def test_disallowed_file_is_rejected(client):
    response = put_config(client, "not_allowed.txt", "x")
    assert response.status_code == 403


def test_non_string_content_is_rejected(client):
    response = put_config(client, "custom_env.ini", {"CNAUTO": "yes"})
    assert response.status_code == 400
    assert "string" in response.get_json()["error"]


def test_custom_env_requires_assignment_syntax(client):
    response = put_config(client, "custom_env.ini", "CNAUTO=yes\n")
    assert response.status_code == 400
    assert "Content validation failed" in response.get_json()["error"]


def test_valid_custom_env_is_written_and_backup_is_created(client, tmp_path):
    target = tmp_path / "custom_env.ini"
    target.write_text('CNAUTO="no"\n', encoding="utf-8")
    response = put_config(client, "custom_env.ini", 'CNAUTO="yes"\n')
    assert response.status_code == 200
    assert target.read_text(encoding="utf-8") == 'CNAUTO="yes"\n'
    assert (tmp_path / "custom_env.ini.bak").read_text(encoding="utf-8") == 'CNAUTO="no"\n'


def test_custom_mod_rejects_invalid_yaml(client):
    response = put_config(client, "custom_mod.yaml", "Zones:\n - zone: [broken\n")
    assert response.status_code == 400
    assert "YAML" in response.get_json()["error"]


def test_ttl_rules_require_valid_separator(client):
    response = put_config(client, "force_ttl_rules.txt", "example.com 1.2.3.4\n")
    assert response.status_code == 400
    assert "TTL" in response.get_json()["error"]


def test_domain_rule_list_rejects_unsupported_special_chars(client):
    response = put_config(client, "force_forward_list.txt", "domain:bad;example.com\n")
    assert response.status_code == 400
    assert "特殊字符" in response.get_json()["error"]


def test_domain_rule_list_allows_regexp_rules(client, tmp_path):
    response = put_config(client, "force_dnscrypt_list.txt", "regexp:^(.+\\.)?example\\.com$\n")
    assert response.status_code == 200
    assert (tmp_path / "force_dnscrypt_list.txt").read_text(encoding="utf-8").startswith("regexp:")


def test_tracker_list_requires_url(client):
    response = put_config(client, "trackerslist.txt", "tracker.example.com/announce\n")
    assert response.status_code == 400
    assert "Tracker URL" in response.get_json()["error"]


def test_per_file_size_limit_returns_413(client):
    oversized = 'A="' + ("x" * (256 * 1024)) + '"\n'
    response = put_config(client, "custom_env.ini", oversized)
    assert response.status_code == 413


def test_untrusted_peer_cannot_spoof_client_ip(client, monkeypatch):
    monkeypatch.setenv("WEB_UI_TRUSTED_PROXIES", "10.0.0.0/8")
    with backend.app.test_request_context(
        "/api/status",
        headers={"X-Forwarded-For": "203.0.113.9"},
        environ_base={"REMOTE_ADDR": "192.0.2.10"},
    ):
        assert backend._client_ip() == "192.0.2.10"


def test_trusted_proxy_can_forward_client_ip(client, monkeypatch):
    monkeypatch.setenv("WEB_UI_TRUSTED_PROXIES", "192.0.2.0/24")
    with backend.app.test_request_context(
        "/api/status",
        headers={"X-Forwarded-For": "203.0.113.9, 192.0.2.10"},
        environ_base={"REMOTE_ADDR": "192.0.2.10"},
    ):
        assert backend._client_ip() == "203.0.113.9"
