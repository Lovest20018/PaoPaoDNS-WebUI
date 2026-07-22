# PaoPaoDNS Config

一个给 [PaoPaoDNS](https://github.com/kkkgo/PaoPaoDNS) 使用的轻量配置文件编辑器。

它以 sidecar 容器运行，与 PaoPaoDNS 共享 `/data`。项目只负责安全地读取和保存上游支持的用户配置文件，不管理容器、不生成部署配置，也不推断主容器的运行状态。

## 能做什么

- 在一个页面中编辑 9 个 PaoPaoDNS 用户配置文件
- 保存前校验环境变量、YAML、域名列表、TTL 和 Tracker URL 格式
- 保存旧内容为同目录 `.bak` 文件
- 使用原路径截断写入，让 PaoPaoDNS 的 `inotifywait` 能观察到变更
- 提示配置会自动加载、需要执行 `reload.sh`，还是需要重启容器
- 使用 Token 保护所有配置 API，并记录鉴权失败和文件写入日志

| 分组 | 文件 |
| --- | --- |
| 基础参数 | `custom_env.ini` |
| 域名分流 | `force_recurse_list.txt`、`force_dnscrypt_list.txt`、`force_forward_list.txt`、`custom_cn_mark.txt` |
| 规则 | `force_ttl_rules.txt`、`trackerslist.txt` |
| 专家配置 | `custom_mod.yaml`、`unbound_custom.conf` |

## 快速部署

### 与 PaoPaoDNS 一起部署

```bash
git clone https://github.com/Lovest20018/PaoPaoDNS-WebUI.git
cd PaoPaoDNS-WebUI
export WEB_UI_TOKEN="$(openssl rand -hex 32)"
docker compose -f docker-compose-web.yaml up -d
```

打开 `http://你的服务器:8080`，输入 `WEB_UI_TOKEN`。

### 接入已有 PaoPaoDNS

编辑 `docker-compose.sidecar.yaml`，让 WebUI 挂载 PaoPaoDNS 正在使用的同一个 `/data` bind mount 或 named volume，然后运行：

```bash
export WEB_UI_TOKEN="$(openssl rand -hex 32)"
docker compose -f docker-compose.sidecar.yaml up -d
```

Bind mount 示例：

```yaml
services:
  paopaodns-web:
    image: ghcr.io/lovest20018/paopaodns-webui:latest
    volumes:
      - /opt/paopaodns/data:/data
    environment:
      - DATA_DIR=/data
      - WEB_UI_TOKEN=${WEB_UI_TOKEN}
    ports:
      - "8080:8080"
```

WebUI 不需要加入 PaoPaoDNS 的容器网络，也不需要 Docker socket。二者唯一的交互面是共享的 `/data`。

## 配置生效

| 文件 | 生效方式 |
| --- | --- |
| `custom_env.ini` | PaoPaoDNS 自动加载 |
| `force_recurse_list.txt` | PaoPaoDNS 自动加载 |
| `force_dnscrypt_list.txt` | PaoPaoDNS 自动加载 |
| `force_forward_list.txt` | 启用 `CNAUTO` 和 `CUSTOM_FORWARD` 时自动加载 |
| `force_ttl_rules.txt` | 启用 `CNAUTO` 且 `RULES_TTL > 0` 时自动加载 |
| `custom_cn_mark.txt` | 启用 `CNAUTO` 和 `USE_MARK_DATA` 时自动加载 |
| `trackerslist.txt` | 启用 `CNAUTO` 和 `CN_TRACKER` 时自动加载 |
| `custom_mod.yaml` | 保存后在主容器中执行 `reload.sh` |
| `unbound_custom.conf` | 保存后重启 PaoPaoDNS 容器 |

WebUI 不检查主容器中的开关和进程，因此条件生效提示描述的是上游规则，而不是对运行状态的推断。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATA_DIR` | `/data` | PaoPaoDNS 数据目录 |
| `WEB_UI_TOKEN` | 空 | API Token；未设置时默认拒绝访问 |
| `WEB_UI_ALLOW_NO_AUTH` | `false` | 设为 `true` 可允许无 Token 访问，不推荐 |
| `WEB_UI_TRUSTED_PROXIES` | 空 | 可提供 `X-Forwarded-For` 的代理 IP/CIDR，逗号分隔 |

后端开发模式会读取 `web/backend/.env`，但不会覆盖进程中已经存在的环境变量。

## 安全边界

- 后端只允许访问固定白名单中的文件，文件名不能用于遍历目录。
- 单文件限制为 256KB、512KB 或 2MB，具体取决于文件类型。
- 每次写入前进行服务端格式校验。
- 已存在的文件会先复制为 `文件名.bak`，写入失败时尽力回滚。
- `X-Forwarded-For` 仅在直接连接方属于 `WEB_UI_TRUSTED_PROXIES` 时采信。
- 项目不挂 Docker socket、不执行 shell 命令，也不控制 PaoPaoDNS 容器。

建议只在可信内网访问。如果通过公网或反向代理开放，请同时启用 HTTPS 和额外访问控制。

## 本地开发与验证

```bash
cd web
npm install
npm run dev
```

另一个终端：

```bash
cd web/backend
cp .env.example .env
pip install -r requirements.txt
python app.py
```

验证：

```bash
cd web
npm run lint
npm run build

cd backend
pytest
```

## API

```text
GET  /api/status
GET  /api/configs
GET  /api/configs/:filename
PUT  /api/configs/:filename
```

本项目是独立的非官方工具。PaoPaoDNS 的配置格式与生效行为以上游项目为准。
