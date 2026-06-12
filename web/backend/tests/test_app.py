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


def put_file(client, filename: str, content, headers=None):
    return client.put(
        f"/api/file/{filename}",
        json={"content": content},
        headers=headers or AUTH_HEADERS,
    )


def test_status_requires_auth(client):
    response = client.get("/api/status")

    assert response.status_code == 401


def test_status_accepts_bearer_token(client):
    response = client.get("/api/status", headers=AUTH_HEADERS)

    assert response.status_code == 200
    assert response.get_json()["auth_enabled"] is True


def test_status_includes_dns_test_target(client, monkeypatch):
    monkeypatch.setattr(backend, "DNS_TEST_SERVER", "dns.local")
    monkeypatch.setattr(backend, "DNS_TEST_PORT", 5353)
    monkeypatch.setattr(backend, "DNS_TEST_TIMEOUT", 1.5)

    response = client.get("/api/status", headers=AUTH_HEADERS)

    assert response.status_code == 200
    assert response.get_json()["dns_test"] == {
        "server": "dns.local",
        "port": 5353,
        "timeout": 1.5,
    }


def test_status_includes_mirrored_runtime_env(client, monkeypatch):
    monkeypatch.setenv("DNSPORT", "5353")
    monkeypatch.setenv("DNS_SERVERNAME", "Lovest_DNS")
    monkeypatch.setenv("SERVER_IP", "192.168.8.88")
    monkeypatch.setenv("IPV6", "yes_only6")
    monkeypatch.setenv("CUSTOM_FORWARD", "192.168.8.99:53")
    monkeypatch.setenv("ADDINFO", "no")

    response = client.get("/api/status", headers=AUTH_HEADERS)

    assert response.status_code == 200
    env = response.get_json()["env"]
    assert env["DNSPORT"] == "5353"
    assert env["DNS_SERVERNAME"] == "Lovest_DNS"
    assert env["SERVER_IP"] == "192.168.8.88"
    assert env["IPV6"] == "yes_only6"
    assert env["CUSTOM_FORWARD"] == "192.168.8.99:53"
    assert env["ADDINFO"] == "no"


def test_disallowed_file_is_rejected(client):
    response = put_file(client, "not_allowed.txt", "x")

    assert response.status_code == 403


def test_non_string_content_is_rejected(client):
    response = put_file(client, "custom_env.ini", {"CNAUTO": "yes"})

    assert response.status_code == 400
    assert "string" in response.get_json()["error"]


def test_custom_env_requires_assignment_syntax(client):
    response = put_file(client, "custom_env.ini", "CNAUTO=yes\n")

    assert response.status_code == 400
    assert "Content validation failed" in response.get_json()["error"]


def test_valid_custom_env_is_written_and_backup_is_created(client, tmp_path):
    target = tmp_path / "custom_env.ini"
    target.write_text('CNAUTO="no"\n', encoding="utf-8")

    response = put_file(client, "custom_env.ini", 'CNAUTO="yes"\n')

    assert response.status_code == 200
    assert target.read_text(encoding="utf-8") == 'CNAUTO="yes"\n'
    assert (tmp_path / "custom_env.ini.bak").read_text(encoding="utf-8") == 'CNAUTO="no"\n'


def test_custom_mod_rejects_invalid_yaml(client):
    response = put_file(client, "custom_mod.yaml", "Zones:\n - zone: [broken\n")

    assert response.status_code == 400
    assert "YAML" in response.get_json()["error"]


def test_ttl_rules_require_valid_separator(client):
    response = put_file(client, "force_ttl_rules.txt", "example.com 1.2.3.4\n")

    assert response.status_code == 400
    assert "TTL" in response.get_json()["error"]


def test_domain_rule_list_rejects_unsupported_special_chars(client):
    response = put_file(client, "force_forward_list.txt", "domain:bad;example.com\n")

    assert response.status_code == 400
    assert "特殊字符" in response.get_json()["error"]


def test_domain_rule_list_allows_regexp_rules(client, tmp_path):
    response = put_file(client, "force_dnscrypt_list.txt", "regexp:^(.+\\.)?example\\.com$\n")

    assert response.status_code == 200
    assert (tmp_path / "force_dnscrypt_list.txt").read_text(encoding="utf-8").startswith("regexp:")


def test_tracker_list_requires_url(client):
    response = put_file(client, "trackerslist.txt", "tracker.example.com/announce\n")

    assert response.status_code == 400
    assert "Tracker URL" in response.get_json()["error"]


def test_per_file_size_limit_returns_413(client):
    oversized = 'A="' + ("x" * (256 * 1024)) + '"\n'

    response = put_file(client, "custom_env.ini", oversized)

    assert response.status_code == 413


def test_dns_test_rejects_invalid_domain(client):
    response = client.post(
        "/api/dns-test",
        json={"domain": "bad domain", "record_type": "A"},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 400


def test_dns_test_uses_configurable_target(client, monkeypatch):
    calls = []

    def fake_lookup(domain, record_type, server, port):
        calls.append((domain, record_type, server, port))
        return {
            "available": True,
            "domain": domain,
            "record_type": record_type,
            "server": server,
            "port": port,
            "answers": [{"name": domain, "type": record_type, "ttl": 60, "value": "1.2.3.4"}],
            "results": ["1.2.3.4"],
            "elapsed_ms": 1.2,
            "rcode": "NOERROR",
        }

    monkeypatch.setattr(backend, "_dns_lookup", fake_lookup)

    response = client.post(
        "/api/dns-test",
        json={"domain": "www.example.com", "record_type": "A", "server": "dns.local", "port": 5353},
        headers=AUTH_HEADERS,
    )

    assert response.status_code == 200
    assert response.get_json()["results"] == ["1.2.3.4"]
    assert calls == [("www.example.com", "A", "dns.local", 5353)]


def test_health_check_aggregates_dns_tests(client, monkeypatch):
    def fake_health_check(server, port):
        return {
            "pass": True,
            "server": server,
            "port": port,
            "tests": {
                "cn": {"domain": "www.baidu.com", "resolved": True},
                "non_cn": {"domain": "www.google.com", "resolved": True},
            },
        }

    monkeypatch.setattr(backend, "_run_health_check", fake_health_check)

    response = client.get("/api/health-check?server=dns.local&port=5353", headers=AUTH_HEADERS)

    assert response.status_code == 200
    assert response.get_json()["pass"] is True
    assert response.get_json()["server"] == "dns.local"
    assert response.get_json()["port"] == 5353
