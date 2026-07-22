# Backend

Flask API for the lightweight PaoPaoDNS configuration editor.

It only exposes system readability and a fixed whitelist of configuration files. Writes are authenticated, validated, size-limited, logged, backed up to `.bak`, and performed in place for compatibility with PaoPaoDNS `inotifywait` watchers.

## Development

```bash
cp .env.example .env
pip install -r requirements.txt
python app.py
```

Supported environment variables:

- `DATA_DIR` — shared configuration directory, default `/data`
- `WEB_UI_TOKEN` — Bearer token required by all `/api/*` routes
- `WEB_UI_ALLOW_NO_AUTH` — explicitly allow unauthenticated access, default `false`
- `WEB_UI_TRUSTED_PROXIES` — comma-separated proxy IPs/CIDRs allowed to provide `X-Forwarded-For`

## API

```text
GET  /api/status
GET  /api/configs
GET  /api/configs/:filename
PUT  /api/configs/:filename
```

## Tests

```bash
python -m pytest tests
```
