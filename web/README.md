# PaoPaoDNS Web UI

PaoPaoDNS 的 Web 配置管理面板，以 sidecar 容器方式与 PaoPaoDNS 共享 `/data` 卷运行。本仓库独立于 [PaoPaoDNS](https://github.com/kkkgo/PaoPaoDNS) 原项目，不修改其任何文件。

## 功能

### 运行时配置管理（读写 /data，保存后自动热重载）

- **概览** — /data 目录状态、鉴权状态、DNS 架构图、文件热重载情况
- **环境变量** — 查看 custom_env.ini 中的运行时覆盖值
- **域名列表** — 编辑 force_forward_list.txt / force_dnscrypt_list.txt / force_recurse_list.txt / custom_cn_mark.txt / trackerslist.txt（Tracker 列表仅文本编辑）
- **TTL 规则** — 编辑 force_ttl_rules.txt
- **高级配置** — 编辑 custom_env.ini / custom_mod.yaml / unbound_custom.conf

### 部署配置生成器（仅导出，不写入 /data）

- **部署配置** — 可视化编辑 Docker Compose / docker run 参数，导出为文件

## 界面预览

### 概览

查看 `/data` 目录读写状态、Token 鉴权状态、关键配置文件是否存在，以及各文件保存后的热重载条件。

![概览](../docs/screenshots/overview.png)

### 域名列表

支持常用分流列表的文本编辑和可视化编辑，可在列表中插入规则或注释，保存后根据当前运行条件提示是否会自动热重载。

![域名列表](../docs/screenshots/domain-lists.png)

### 部署生成

可视化生成 `docker-compose.yaml` 或 `docker run` 命令，用于新建 PaoPaoDNS 容器或重新部署；此页面只导出配置，不写入 `/data`。

![部署生成](../docs/screenshots/deploy.png)

### TTL 规则

可视化编辑 `force_ttl_rules.txt`，适合把指定域名转发到指定 DNS 或直接指定 A/AAAA/CNAME 结果。

![TTL 规则](../docs/screenshots/ttl-rules.png)

### 高级配置

编辑 `custom_env.ini`、`custom_mod.yaml`、`unbound_custom.conf`。页面会根据文件类型提示自动热重载、手动 reload 或重启容器。

![高级配置](../docs/screenshots/advanced-config.png)

## 使用流程

1. 部署 PaoPaoDNS 与 Web UI，并确认两个容器共享同一个 `/data` volume 或 bind mount。
2. 访问 `http://宿主机IP:8080`，输入 `WEB_UI_TOKEN` 完成鉴权；本机访问也可使用 `http://127.0.0.1:8080`。
3. 在「概览」确认 `/data` 可读写、文件存在状态和热重载条件。
4. 在「域名列表」「TTL 规则」「高级配置」中编辑对应文件并保存。
5. 根据保存后的提示判断配置是否已自动热重载；如果提示需要 reload 或重启，请在宿主机执行对应操作。
6. 如需重新部署，可在「部署配置」中导出 `docker-compose.yaml` 或 `docker run` 命令。

## 架构

```
┌─────────────────────┐    ┌─────────────────────┐
│   PaoPaoDNS 容器     │    │   Web UI 容器        │
│   sliamb/paopaodns   │    │   GHCR 镜像         │
│                     │    │                     │
│  /data ◄────────┐  │    │  /data ◄────────┐  │
│  inotifywait 监听 │  │    │  Flask API 读写  │  │
│  自动热重载       │  │    │  React 前端      │  │
└─────────────────│──┘    └─────────────────│──┘
                  │                         │
                  └──── paopaodns-data ─────┘
                       (共享 Docker volume)
```

**不依赖 Docker socket，不安装 Docker CLI，不控制主容器。**

## 快速开始

### 方式一：与 PaoPaoDNS 一起部署（推荐）

适用于还没有部署 PaoPaoDNS，或愿意用本仓库的 compose 文件重新部署的场景。

```bash
# 克隆本仓库
git clone https://github.com/Lovest20018/PaoPaoDNS-WebUI.git
cd PaoPaoDNS-WebUI

# 生成并导出 token（重要！）
export WEB_UI_TOKEN=$(openssl rand -hex 32)

# 启动（包含 PaoPaoDNS + Web UI）
docker compose -f docker-compose-web.yaml up -d

# 打开浏览器
# http://宿主机IP:8080
```

`docker-compose-web.yaml` 同时编排了 PaoPaoDNS 和 Web UI，共享同一个 data 卷。compose 文件会把关键运行环境变量同步给 Web UI 容器，用于更准确判断热重载条件。

默认映射为 `8080:8080`，允许局域网或外部访问宿主机 `8080` 端口。如果宿主机 `8080` 已被占用，只需要改冒号左侧的宿主机端口，例如 `8123:8080`；容器内端口 `8080` 保持不变。若只希望本机访问，可改为 `127.0.0.1:8080:8080`。

### 方式二：给已有的 PaoPaoDNS 容器添加 Web UI

如果你已经有一个运行中的 PaoPaoDNS 容器，只需添加 Web UI sidecar。

**绑定挂载方式**（数据目录在宿主机上有明确路径）：

```bash
# 克隆本仓库
git clone https://github.com/Lovest20018/PaoPaoDNS-WebUI.git
cd PaoPaoDNS-WebUI

# 可选：先保存当前 PaoPaoDNS 容器的环境变量，后面按实际值同步到 .env
docker inspect paopaodns --format '{{range .Config.Env}}{{println .}}{{end}}' | sort > paopaodns-old-env.txt
```

创建 `.env`：

```bash
cat > .env <<EOF
WEB_UI_TOKEN=$(openssl rand -hex 32)

# Web UI 镜像；默认使用 GHCR 预构建镜像，不需要本地 build
PAOPAODNS_WEB_IMAGE=ghcr.io/lovest20018/paopaodns-webui:latest

# 建议按 paopaodns-old-env.txt 中的实际值填写，仅用于 Web UI 判断热重载条件
TZ=Asia/Shanghai
CNAUTO=yes
CNFALL=yes
IPV6=no
CN_TRACKER=yes
USE_MARK_DATA=yes
CUSTOM_FORWARD=
RULES_TTL=0
EOF

chmod 600 .env
```

如果你使用下面的 `docker run` 命令，请先把 `.env` 加载到当前 shell：

```bash
set -a
. ./.env
set +a
```

如果使用 `docker compose`，Compose 会自动读取同目录的 `.env`。

如果你要本地开发或 GHCR 镜像还没发布，也可以手动构建：

```bash
docker build -t paopaodns-web ./web
export PAOPAODNS_WEB_IMAGE=paopaodns-web
```

然后运行 Web UI：

```bash
# 运行（替换实际的数据目录路径）
docker run -d \
  --name paopaodns-web \
  --restart always \
  -v /你的/paopaodns/data:/data \
  -e DATA_DIR=/data \
  -e WEB_UI_TOKEN="$WEB_UI_TOKEN" \
  -e TZ="${TZ:-Asia/Shanghai}" \
  -e CNAUTO="${CNAUTO:-yes}" \
  -e CNFALL="${CNFALL:-yes}" \
  -e IPV6="${IPV6:-no}" \
  -e CN_TRACKER="${CN_TRACKER:-yes}" \
  -e USE_MARK_DATA="${USE_MARK_DATA:-yes}" \
  -e CUSTOM_FORWARD="${CUSTOM_FORWARD:-}" \
  -e RULES_TTL="${RULES_TTL:-0}" \
  -p 8080:8080 \
  "$PAOPAODNS_WEB_IMAGE"
```

**Named volume 方式**（PaoPaoDNS 使用 Docker named volume）：

先查 volume 名：

```bash
docker inspect paopaodns --format '{{range .Mounts}}{{.Name}} {{end}}'
```

然后用同样的 volume：

```bash
docker run -d \
  --name paopaodns-web \
  --restart always \
  -v paopaodns-data:/data \
  -e DATA_DIR=/data \
  -e WEB_UI_TOKEN="$WEB_UI_TOKEN" \
  -e TZ="${TZ:-Asia/Shanghai}" \
  -e CNAUTO="${CNAUTO:-yes}" \
  -e CNFALL="${CNFALL:-yes}" \
  -e IPV6="${IPV6:-no}" \
  -e CN_TRACKER="${CN_TRACKER:-yes}" \
  -e USE_MARK_DATA="${USE_MARK_DATA:-yes}" \
  -e CUSTOM_FORWARD="${CUSTOM_FORWARD:-}" \
  -e RULES_TTL="${RULES_TTL:-0}" \
  -p 8080:8080 \
  "$PAOPAODNS_WEB_IMAGE"
```

### 方式三：整合到现有 docker-compose

如果你已有 PaoPaoDNS 的 compose 文件，只需加一个 service：

```yaml
services:
  # ... 你已有的 paopaodns service ...

  paopaodns-web:
    image: ghcr.io/lovest20018/paopaodns-webui:latest
    container_name: paopaodns-web
    restart: always
    volumes:
      - paopaodns-data:/data     # 与 PaoPaoDNS 共享同一个 volume
    environment:
      - DATA_DIR=/data
      - WEB_UI_TOKEN=${WEB_UI_TOKEN:?set WEB_UI_TOKEN, e.g. openssl rand -hex 32}
      # 建议镜像 PaoPaoDNS 的关键启动变量，便于 Web UI 准确判断热重载条件
      - CNAUTO=${CNAUTO:-yes}
      - CN_TRACKER=${CN_TRACKER:-yes}
      - USE_MARK_DATA=${USE_MARK_DATA:-yes}
      - CUSTOM_FORWARD=${CUSTOM_FORWARD:-}
      - RULES_TTL=${RULES_TTL:-0}
    ports:
      - "8080:8080"
    depends_on:
      - paopaodns
```

确保 `volumes` 中的 volume 名与 PaoPaoDNS 的 `/data` volume 一致。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DATA_DIR` | `/data` | PaoPaoDNS 数据目录路径 |
| `WEB_UI_TOKEN` | _(空)_ | 访问 API 的认证 Token。**必须设置**，否则默认拒绝访问 |
| `WEB_UI_ALLOW_NO_AUTH` | `false` | 设为 `true` 允许无 Token 访问（不推荐） |
| `CNAUTO` / `CN_TRACKER` / `USE_MARK_DATA` / `CUSTOM_FORWARD` / `RULES_TTL` | _(可选)_ | 建议与 PaoPaoDNS 容器保持一致，仅用于 Web UI 判断文件是否会被当前运行配置自动热重载 |

## 鉴权说明

**默认必须设置 `WEB_UI_TOKEN`，否则 Web UI 无法访问。**

这是有意为之的安全设计：

- Web UI 可以修改 DNS 分流规则、转发配置、环境变量
- 如果暴露到网络且无鉴权，任何人都可以篡改你的 DNS
- 即使端口绑定 `127.0.0.1`，经过反向代理后仍可能暴露

如果你确定不需要鉴权（例如只在本地使用、没有安全风险），可以显式设置：

```yaml
environment:
  - WEB_UI_ALLOW_NO_AUTH=true
```

## 文件热重载行为

PaoPaoDNS 通过 `inotifywait` 监听 `/data` 目录文件变更，部分文件会自动热重载，部分需要额外操作：

### 自动热重载（保存即生效）

| 文件 | 条件 |
|---|---|
| `custom_env.ini` | 无条件 |
| `force_dnscrypt_list.txt` | 无条件 |
| `force_recurse_list.txt` | 无条件 |
| `force_forward_list.txt` | 需要 CUSTOM_FORWARD 配置且 CNAUTO=yes |
| `force_ttl_rules.txt` | 需要 RULES_TTL > 0 且 CNAUTO=yes |
| `custom_cn_mark.txt` | 需要 USE_MARK_DATA=yes 且 CNAUTO=yes |
| `trackerslist.txt` | 需要 CN_TRACKER=yes 且 CNAUTO=yes |

### 需要手动操作

| 文件 | 操作 |
|---|---|
| `custom_mod.yaml` | 在宿主机执行 `docker exec paopaodns reload.sh` 或重启容器 |
| `unbound_custom.conf` | 重启 PaoPaoDNS 容器 |

Web UI 保存后会根据当前配置自动判断并提示热重载状态。由于 Web UI 不挂 Docker socket，它不能直接读取另一个容器的启动环境变量；如需提示完全准确，请像示例 compose 一样把关键启动变量镜像到 Web UI 容器。`custom_env.ini` 中的启用变量会作为运行时覆盖参与判断。

## 安全设计

- **不挂 Docker socket** — Web UI 无法控制任何容器
- **不装 Docker CLI** — 镜像最小化，减少攻击面
- **文件白名单** — 只能读写预设的 9 个配置文件，不能遍历 /data
- **安全写入** — 写入前复制 `.bak` 备份，然后原路径写入/截断，确保 PaoPaoDNS 对单文件路径的 inotify 监听能收到变更事件
- **写入大小限制** — 单次写入最大 2MB，按文件类型细分
- **Token 鉴权** — 默认强制认证，仅支持 Bearer token
- **敏感变量 mask** — 含 TOKEN/PASSWORD/SECRET/KEY 的值在 API 中显示为 `***`
- **端口暴露可控** — 默认示例暴露 `8080:8080` 便于局域网访问；只需本机访问时可改为 `127.0.0.1:8080:8080`

## 页面说明

### 概览

- /data 目录读写状态
- Token 认证状态（未启用时红色警告）
- 当前运行配置总览（CNAUTO、IPv6、域名标记库）
- DNS 解析架构图（根据 CNAUTO 自动切换）
- /data 文件存在状态和热重载条件

### 环境变量

- 显示 custom_env.ini 中的运行时覆盖值（只读）
- 对比默认值，标记已覆盖项
- 引导到高级配置页面进行修改

### 域名列表

- force_forward_list.txt / force_dnscrypt_list.txt / force_recurse_list.txt / custom_cn_mark.txt 支持可视化/文本编辑
- trackerslist.txt 是 Tracker URL 列表，仅支持文本编辑，避免误改成 domain 规则
- 支持域名前缀语法（domain: / full: / regexp: / keyword:）
- 保存后根据条件提示热重载状态

### 部署配置

- 可视化编辑 Docker Compose 参数
- 支持服务名/容器名分离、端口映射、环境变量、资源限制
- TCP+UDP 端口自动展开为两条映射
- 使用 YAML 库生成，正确处理特殊字符和 Windows 路径
- 仅导出，不写入 /data，不修改原项目文件

### TTL 规则

- force_ttl_rules.txt 的可视化/文本编辑
- 保存后根据 RULES_TTL 和 CNAUTO 条件提示热重载状态

### 高级配置

- **custom_env.ini** — 运行时变量覆盖，保存后自动热重载
- **custom_mod.yaml** — Zones/Swaps/Hosts 自定义，保存后需手动 reload（提供命令复制按钮）
- **unbound_custom.conf** — Unbound 自定义配置，保存后需重启容器

## 开发

```bash
# 安装前端依赖
cd web && npm install

# 开发模式（需要单独运行后端）
npm run dev

# 构建
npm run build

# 运行后端（开发）
cd backend
pip install -r requirements.txt
DATA_DIR=/path/to/paopaodns/data WEB_UI_ALLOW_NO_AUTH=true python app.py
```

## 技术栈

**前端**
- React 19 + TypeScript
- Vite 8
- Zustand 5（状态管理）
- yaml（Compose YAML 生成）
- lucide-react（图标）

**后端**
- Flask + gunicorn
- Python 3.12 Alpine

**容器**
- 多阶段构建（Node 22 Alpine 编译前端 → Python 3.12 Alpine 运行）
- 不安装 Docker CLI
- 不挂载 Docker socket

## 注意事项

- Web UI 保存 `custom_mod.yaml` 后不会自动生效，需要在宿主机执行 `docker exec paopaodns reload.sh`
- Web UI 无法查看 Docker 启动时的环境变量（需要 Docker socket），只能查看 custom_env.ini 中的覆盖值
- 部署配置页面生成的命令仅用于导出，不会修改任何文件
- 建议将 8080 端口放在反向代理后面，并启用 HTTPS
- 本仓库独立于 PaoPaoDNS 原项目，原项目更新不影响 Web UI，Web UI 也不影响原项目

## 与原项目的关系

本仓库是 [PaoPaoDNS](https://github.com/kkkgo/PaoPaoDNS) 的非官方 Web 管理面板。

- 不修改 PaoPaoDNS 原项目的任何文件（Dockerfile、shell 脚本、compose 等）
- 不依赖 Docker socket 或 Docker CLI
- 仅通过共享 `/data` 目录与 PaoPaoDNS 交互
- PaoPaoDNS 原项目更新时，只需拉取新镜像 `sliamb/paopaodns:latest`，Web UI 不受影响
- 如果 PaoPaoDNS 修改了配置文件格式或热重载逻辑，Web UI 可能需要同步更新
