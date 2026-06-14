# PaoPaoDNS Web UI Backend

Flask backend for PaoPaoDNS Web UI configuration management.

## Features

- ✅ Token-based authentication
- ✅ File whitelist security (only allowed config files)
- ✅ Content validation before saving
- ✅ Backup and rollback on write failure
- ✅ Rate limiting for DNS APIs
- ✅ Operation logging
- ✅ DNS diagnostics (no external dependencies)

## Quick Start

### Development

```bash
# Install dependencies
pip install -r requirements.txt

# Copy environment template
cp .env.example .env

# Edit .env with your settings
# Set WEB_UI_TOKEN and DATA_DIR

# Run development server
python app.py
```

`python app.py` loads `web/backend/.env` automatically for local development.
The server will start on `http://0.0.0.0:8080`

### Production (Docker)

See the main repository README for Docker deployment.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATA_DIR` | No | `/data` | Shared data directory with PaoPaoDNS |
| `WEB_UI_TOKEN` | **Yes** | - | Authentication token (use `openssl rand -hex 32`) |
| `WEB_UI_ALLOW_NO_AUTH` | No | `false` | Allow access without token (NOT RECOMMENDED) |
| `WEB_UI_TRUSTED_PROXIES` | No | - | Comma-separated proxy IPs/CIDRs allowed to supply `X-Forwarded-For` |
| `DNS_TEST_SERVER` | No | `paopaodns` | DNS server for diagnostics |
| `DNS_TEST_PORT` | No | `53` | DNS server port |
| `DNS_TEST_TIMEOUT` | No | `3` | DNS query timeout (seconds) |

### Runtime Environment Variables

These should mirror your PaoPaoDNS container settings:

- `CNAUTO`, `CNFALL`, `IPV6`, `CN_TRACKER`, `USE_MARK_DATA`
- `CUSTOM_FORWARD`, `RULES_TTL`

They help the Web UI accurately determine which files will auto-reload.

## API Endpoints

### Authentication

All `/api/*` endpoints require Bearer token authentication:

```bash
curl -H "Authorization: Bearer YOUR_TOKEN" http://localhost:8080/api/status
```

### Rate Limits

- `/api/dns-test`: 10 requests per minute per IP
- `/api/health-check`: 5 requests per minute per IP

### Allowed Files

Only these files can be read/written:

- `custom_env.ini` - Auto-reload
- `force_forward_list.txt` - Conditional auto-reload
- `force_dnscrypt_list.txt` - Auto-reload
- `force_recurse_list.txt` - Auto-reload
- `force_ttl_rules.txt` - Conditional auto-reload
- `custom_cn_mark.txt` - Conditional auto-reload
- `trackerslist.txt` - Conditional auto-reload
- `custom_mod.yaml` - Requires `reload.sh`
- `unbound_custom.conf` - Requires container restart

## Testing

```bash
# Run all tests
python -m pytest tests/ -v

# Run specific test
python -m pytest tests/test_app.py::test_dns_test_rate_limit -v

# Run with coverage
python -m pytest tests/ --cov=app --cov-report=html
```

## Logging

Logs are written to stdout in the format:

```
2026-06-15 10:30:15 [INFO] PaoPaoDNS Web UI Backend Starting
2026-06-15 10:31:22 [WARNING] Authentication failed from 192.168.1.100
2026-06-15 10:32:10 [INFO] Writing file 'custom_env.ini' (1024 bytes)
```

### Log Levels

- `INFO`: Normal operations (startup, file writes, DNS queries)
- `WARNING`: Security events (auth failures, rate limits, validation errors)
- `ERROR`: System errors (file write failures)

### Production Logging

For production, configure log rotation:

```bash
# Docker Compose
services:
  paopaodns-web:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

## Security

### Best Practices

1. **Always set `WEB_UI_TOKEN`**: Generate with `openssl rand -hex 32`
2. **Restrict network access**: Use `127.0.0.1:8080:8080` for localhost-only
3. **Use HTTPS in production**: Place behind reverse proxy (Nginx, Caddy)
4. **Monitor logs**: Watch for authentication failures and rate limit triggers
5. **Keep dependencies updated**: `pip install --upgrade -r requirements.txt`

### File Security

- Path traversal protection (whitelist only)
- Content validation before write
- Backup and rollback on failure
- File size limits (2MB default)

### API Security

- Bearer token authentication
- Rate limiting per endpoint and client IP
- `X-Forwarded-For` is ignored unless the immediate peer is listed in `WEB_UI_TRUSTED_PROXIES`
- Input validation (domains, DNS servers, ports)
- No shell command execution

## Troubleshooting

### "Unauthorized" error

- Check `WEB_UI_TOKEN` is set correctly
- Verify token matches between client and server
- Check Authorization header format: `Bearer TOKEN`

### "Rate limit exceeded"

- Wait for the specified retry time
- Adjust limits in code if needed (for legitimate high-traffic use)

### DNS diagnostics fail

- Verify Web UI can reach PaoPaoDNS container
- Check network connectivity: `docker exec paopaodns-web ping paopaodns`
- Verify DNS port is correct (default 53)

### File writes fail

- Check `/data` directory is writable
- Verify file content passes validation
- Check logs for specific error messages

## Development

### Adding New Config Files

1. Add filename to `ALLOWED_FILES` set
2. Add to appropriate reload category:
   - `UNCONDITIONAL_AUTO_RELOAD`
   - `CONDITIONAL_AUTO_RELOAD`
   - `RELOAD_REQUIRED_FILES`
   - `RESTART_REQUIRED_FILES`
3. Add validation function if needed
4. Add tests

### Running Tests During Development

```bash
# Watch mode (requires pytest-watch)
ptw tests/

# With coverage report
python -m pytest tests/ --cov=app --cov-report=term-missing
```

## License

Same as main repository (MIT).
