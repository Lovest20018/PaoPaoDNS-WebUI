# PaoPaoDNS Web UI

一个给 [PaoPaoDNS](https://github.com/kkkgo/PaoPaoDNS) 使用的 Web 配置面板。

它以 sidecar 容器方式运行，和 PaoPaoDNS 共享同一个 `/data` 目录，用来查看、编辑常用配置文件。Web UI 不挂载 Docker socket，不控制主容器，只负责安全地读写 `/data` 中的配置文件。

> 适合已经在用 PaoPaoDNS，但不想每次都手动编辑 `custom_env.ini`、各种 `force_*_list.txt`、`force_ttl_rules.txt` 的用户。

## 主要功能

- 查看 `/data` 目录状态、认证状态、配置文件是否存在
- 查看文件保存后是否会自动热重载，以及未生效原因
- DNS 诊断：对目标 DNS 服务执行 A / AAAA / CNAME 查询和 CN/非 CN 健康检查
- 编辑 `custom_env.ini`，支持启用/禁用变量
- 编辑域名列表：
  - `force_forward_list.txt`
  - `force_dnscrypt_list.txt`
  - `force_recurse_list.txt`
  - `custom_cn_mark.txt`
  - `trackerslist.txt`（Tracker URL 列表，仅文本编辑）
- 编辑 `force_ttl_rules.txt`，支持 `@`、`@@`、`@@@` 规则
- 编辑 `custom_mod.yaml`、`unbound_custom.conf`
- 生成 docker compose / docker run 部署配置，支持完整部署和仅 Web UI sidecar 两种模式
- 后端保存前校验文件内容和大小，写入时保留 `.bak` 备份并在失败时回滚
- 支持亮色/暗色主题

## 界面预览

### 概览

查看 `/data` 目录读写状态、Token 鉴权状态、关键配置文件是否存在、各文件保存后的热重载条件，以及 DNS 查询诊断结果。

![概览](docs/screenshots/overview.png)

### 域名列表

支持常用分流列表的文本编辑和可视化编辑，可在列表中插入规则或注释，保存后根据当前运行条件提示是否会自动热重载。

![域名列表](docs/screenshots/domain-lists.png)

### 部署生成

可视化生成 `docker-compose.yaml` 或 `docker run` 命令，可选择同时部署 PaoPaoDNS + Web UI，或只生成接入已有 `/data` 的 Web UI sidecar；此页面只导出配置，不写入 `/data`。

![部署生成](docs/screenshots/deploy.png)

### TTL 规则

可视化编辑 `force_ttl_rules.txt`，适合把指定域名转发到指定 DNS 或直接指定 A/AAAA/CNAME 结果。

![TTL 规则](docs/screenshots/ttl-rules.png)

### 高级配置

编辑 `custom_env.ini`、`custom_mod.yaml`、`unbound_custom.conf`。页面会根据文件类型提示自动热重载、手动 reload 或重启容器。

![高级配置](docs/screenshots/advanced-config.png)

## 使用流程

1. 部署 PaoPaoDNS 与 Web UI，并确认两个容器共享同一个 `/data` volume 或 bind mount。
2. 访问 `http://宿主机IP:8080`，输入 `WEB_UI_TOKEN` 完成鉴权；本机访问也可使用 `http://127.0.0.1:8080`。
3. 在「概览」确认 `/data` 可读写、文件存在状态和热重载条件。
4. 如需排查 DNS 可用性，可在「概览」的 DNS 诊断中测试 `A` / `AAAA` / `CNAME` 查询和 CN/非 CN 健康检查。
5. 在「域名列表」「TTL 规则」「高级配置」中编辑对应文件并保存。
6. 根据保存后的提示判断配置是否已自动热重载；如果提示需要 reload 或重启，请在宿主机执行对应操作。
7. 如需重新部署，可在「部署生成」中导出 `docker-compose.yaml` 或 `docker run` 命令。

## 设计原则

- **不需要 Docker socket**：Web UI 不能控制宿主机 Docker，也不能随意操作容器。
- **只读写白名单文件**：后端只允许访问 PaoPaoDNS 常用配置文件。
- **保存前后端校验**：写入前会校验文件格式、大小和危险控制字符，避免明显错误配置落盘。
- **共享 `/data` 即可工作**：Web UI 和 PaoPaoDNS 通过同一个 volume 或 bind mount 配合。
- **保存后给出生效提示**：自动热重载、需要 `reload.sh`、需要重启容器都会在页面提示。

## 快速开始

### 方式一：同时部署 PaoPaoDNS + Web UI

适合还没有部署 PaoPaoDNS，或者愿意用本仓库 compose 文件重新部署的用户。

```bash
git clone https://github.com/Lovest20018/PaoPaoDNS-WebUI.git
cd PaoPaoDNS-WebUI

# 生成 Web UI 登录 Token
export WEB_UI_TOKEN=$(openssl rand -hex 32)

# 启动 PaoPaoDNS + Web UI
docker compose -f docker-compose-web.yaml up -d
```

启动后访问：

```text
http://宿主机IP:8080
```

登录时使用刚才生成的 `WEB_UI_TOKEN`。

默认映射为 `8080:8080`，允许局域网或外部访问宿主机 `8080` 端口。如果宿主机 `8080` 已被占用，只需要改冒号左侧的宿主机端口，例如 `8123:8080`；容器内端口 `8080` 保持不变。若只希望本机访问，可改为 `127.0.0.1:8080:8080`。

`docker-compose-web.yaml` 会创建两个服务：

- `paopaodns`：官方 `sliamb/paopaodns:latest` 镜像
- `paopaodns-web`：GHCR 预构建 Web UI 镜像（默认 `ghcr.io/lovest20018/paopaodns-webui:latest`）

两个容器共享同一个 `paopaodns-data` volume。

DNS 诊断默认从 Web UI 容器访问 `paopaodns:53`。使用本仓库的 `docker-compose-web.yaml` 时，两个服务在同一个 Compose 网络中，通常不需要额外配置。

### 方式二：给已有 PaoPaoDNS 添加 Web UI

如果你已经有一个运行中的 PaoPaoDNS 容器，只需要让 Web UI 挂载同一个 `/data`。

#### 1. 选择 Web UI 镜像

```bash
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

# DNS 诊断目标；Web UI 容器必须能访问该地址和端口
DNS_TEST_SERVER=paopaodns
DNS_TEST_PORT=53
DNS_TEST_TIMEOUT=3

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

如果要在已有 PaoPaoDNS 容器上使用 DNS 诊断，请确保 Web UI 容器能访问 PaoPaoDNS 的 DNS 端口。常见做法是让两个容器加入同一个用户自定义 Docker network，然后把 `DNS_TEST_SERVER` 设置为 PaoPaoDNS 的容器名、服务名或容器内可访问的 IP。即使 DNS 诊断暂时不可用，配置文件编辑仍然可以正常工作。

#### 2A. 如果 PaoPaoDNS 使用宿主机目录

假设你的 PaoPaoDNS 数据目录是 `/opt/paopaodns/data`：

```bash
docker run -d \
  --name paopaodns-web \
  --restart unless-stopped \
  -v /opt/paopaodns/data:/data \
  -e DATA_DIR=/data \
  -e WEB_UI_TOKEN="$WEB_UI_TOKEN" \
  -e DNS_TEST_SERVER="${DNS_TEST_SERVER:-paopaodns}" \
  -e DNS_TEST_PORT="${DNS_TEST_PORT:-53}" \
  -e DNS_TEST_TIMEOUT="${DNS_TEST_TIMEOUT:-3}" \
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

#### 2B. 如果 PaoPaoDNS 使用 Docker named volume

先查看 PaoPaoDNS 使用的 volume：

```bash
docker inspect paopaodns --format '{{range .Mounts}}{{.Name}} {{end}}'
```

假设查到的是 `paopaodns-data`：

```bash
docker run -d \
  --name paopaodns-web \
  --restart unless-stopped \
  -v paopaodns-data:/data \
  -e DATA_DIR=/data \
  -e WEB_UI_TOKEN="$WEB_UI_TOKEN" \
  -e DNS_TEST_SERVER="${DNS_TEST_SERVER:-paopaodns}" \
  -e DNS_TEST_PORT="${DNS_TEST_PORT:-53}" \
  -e DNS_TEST_TIMEOUT="${DNS_TEST_TIMEOUT:-3}" \
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

也可以直接参考：

```bash
docker compose -f docker-compose.sidecar.yaml up -d
```

使用前请按你的实际情况修改 `docker-compose.sidecar.yaml` 中的 volume。

## 为什么建议镜像几个 PaoPaoDNS 环境变量？

Web UI 不挂 Docker socket，所以它不能直接读取另一个容器的启动环境变量。

为了让“保存后是否会自动热重载”的提示更准确，建议把这些变量也传给 Web UI 容器：

```yaml
- CNAUTO=yes
- CN_TRACKER=yes
- USE_MARK_DATA=yes
- CUSTOM_FORWARD=
- RULES_TTL=0
```

如果你在 `custom_env.ini` 中配置了同名变量，Web UI 会以 `custom_env.ini` 中启用的值作为运行时覆盖来判断。

## 页面说明

### 概览

查看 `/data` 是否可读写、文件是否存在、各配置文件当前是否满足自动热重载条件，并提供 DNS 查询与健康检查入口。

### DNS 诊断

DNS 诊断从 Web UI 容器向配置的 DNS 服务发起 UDP 查询，支持：

- 自定义域名和记录类型：`A` / `AAAA` / `CNAME`
- 自定义 DNS 服务地址和端口
- 一键 CN/非 CN 健康检查

默认目标由环境变量控制：

```yaml
DNS_TEST_SERVER=paopaodns
DNS_TEST_PORT=53
DNS_TEST_TIMEOUT=3
```

此功能不执行 shell 命令，也不会读取 PaoPaoDNS 容器内部进程、Redis 或 Unbound 状态；它只用于验证 Web UI 容器到 DNS 服务的网络可达性和解析结果。

### 环境变量

只读展示 `custom_env.ini` 中定义的变量覆盖。需要修改时请到“高级配置”。

### 域名列表

适合编辑常用分流列表：

- `domain:example.com`：匹配自身和子域名
- `full:example.com`：完整匹配
- `regexp:`：正则匹配
- `keyword:`：关键字匹配

`trackerslist.txt` 是 Tracker URL 列表，不是域名规则文件，因此页面只提供文本编辑，避免误改格式。

### 部署生成

支持两种模式：

- **完整部署**：同时生成 PaoPaoDNS 主容器和 Web UI sidecar 配置。
- **仅 Web UI sidecar**：接入已经存在的 PaoPaoDNS `/data` 目录或 named volume。

部署生成器可以输出 `docker compose` 或 `docker run`，支持选择 bind mount / named volume、Web UI Token、Web UI 端口、DNS 诊断目标、资源限制和常用 PaoPaoDNS 环境变量。生成结果只用于复制导出，不会自动执行，也不会写入 `/data`。

### TTL 规则

支持 PaoPaoDNS 的 TTL 规则语法：

```text
example.com@1.2.3.4:53
example.com@@1.2.3.4
example.com@@@1.2.3.4
example.com@@target.example.net
example.com@@@target.example.net
```

- `@`：子域名匹配，转发到指定 DNS 服务器，支持 `server:port` 或多个服务器
- `@@`：子域名匹配，直接指定 A/AAAA/CNAME
- `@@@`：精确匹配，直接指定 A/AAAA/CNAME

如果文件中包含可视化编辑无法无损保留的注释或特殊语法，页面会提示并保留文本编辑模式，避免保存时重写原文件。

### 高级配置

- `custom_env.ini`：保存后通常自动热重载
- `custom_mod.yaml`：保存后需要在宿主机执行 `docker exec paopaodns reload.sh` 或重启容器
- `unbound_custom.conf`：保存后需要重启 PaoPaoDNS 容器

保存时后端会对 `custom_env.ini`、`custom_mod.yaml`、域名列表、TTL 规则和 Tracker URL 做基础格式校验；校验失败时不会写入文件。

## 安全建议

- 一定要设置 `WEB_UI_TOKEN`。
- 默认示例会暴露宿主机 `8080` 端口，便于局域网访问。
- 如果只希望本机访问，请把端口映射改为 `127.0.0.1:8080:8080`。
- 如果要通过公网访问，建议放到反向代理后面，并启用 HTTPS。
- 不建议设置 `WEB_UI_ALLOW_NO_AUTH=true`，除非你明确知道风险。

## 常见问题

### 保存后一定立即生效吗？

不一定。不同文件生效方式不同：

| 文件 | 生效方式 |
|---|---|
| `custom_env.ini` | 自动热重载 |
| `force_dnscrypt_list.txt` | 自动热重载 |
| `force_recurse_list.txt` | 自动热重载 |
| `force_forward_list.txt` | 需要 `CNAUTO=yes` 且 `CUSTOM_FORWARD` 有效 |
| `force_ttl_rules.txt` | 需要 `CNAUTO=yes` 且 `RULES_TTL > 0` |
| `custom_cn_mark.txt` | 需要 `CNAUTO=yes` 且 `USE_MARK_DATA=yes` |
| `trackerslist.txt` | 需要 `CNAUTO=yes` 且 `CN_TRACKER=yes` |
| `custom_mod.yaml` | 需要执行 `docker exec paopaodns reload.sh` 或重启容器 |
| `unbound_custom.conf` | 需要重启容器 |

页面保存后会显示当前文件的生效提示。

### DNS 诊断失败怎么办？

DNS 诊断失败通常表示 Web UI 容器无法访问配置的 DNS 服务，而不一定表示 `/data` 文件编辑有问题。请重点检查：

- PaoPaoDNS 容器是否正在运行并监听 DNS 端口。
- Web UI 容器和 PaoPaoDNS 容器是否在同一个可互通的 Docker network。
- `DNS_TEST_SERVER` 是否是 Web UI 容器内可解析或可访问的地址。
- `DNS_TEST_PORT` 是否与 PaoPaoDNS 的 DNS 端口一致，默认是 `53`。

使用本仓库的完整部署 compose 时，默认目标是 `paopaodns:53`。

### 保存失败提示格式错误怎么办？

新版本会在后端保存前校验内容。常见原因包括：

- `custom_env.ini` 不是 `KEY="VALUE"` 格式。
- `custom_mod.yaml` 不是合法 YAML，或顶层不是对象。
- 域名列表包含空白字符或不支持的特殊字符。
- `force_ttl_rules.txt` 规则没有使用 `@`、`@@` 或 `@@@`。
- `trackerslist.txt` 不是有效 Tracker URL。

请按页面报错行号修正后再保存。写入时会保留 `.bak` 备份，并在写入失败时尽量回滚到旧内容。

### 部署生成会直接修改我的容器吗？

不会。部署生成页面只生成 `docker compose` 或 `docker run` 文本，不会执行命令，也不会修改 `/data`。

### Web UI 会不会控制我的 PaoPaoDNS 容器？

不会。Web UI 不挂载 Docker socket，也不安装 Docker CLI。它只读写共享 `/data` 中的配置文件。

### 忘记 Token 怎么办？

重新创建 Web UI 容器，并设置新的 `WEB_UI_TOKEN` 即可。Token 不会写入 `/data`。

### 可以不设置 Token 吗？

可以显式设置：

```yaml
WEB_UI_ALLOW_NO_AUTH=true
```

但不推荐。Web UI 可以修改 DNS 配置，如果暴露到网络，无认证会有明显风险。

## 开发

```bash
cd web
npm install
npm run dev
```

前端开发服务器已配置 `/api` 代理到 `http://127.0.0.1:8080`，因此可以同时启动后端开发服务进行联调。

构建：

```bash
npm --prefix web run build
```

后端开发运行：

```bash
cd web/backend
pip install -r requirements.txt
DATA_DIR=/path/to/paopaodns/data WEB_UI_ALLOW_NO_AUTH=true python app.py
```

后端测试：

```bash
python -m pytest web/backend/tests
```

## 与 PaoPaoDNS 的关系

本项目是 PaoPaoDNS 的非官方 Web 管理面板，核心思路是通过共享 `/data` 文件夹与 PaoPaoDNS 配合。

PaoPaoDNS 原项目地址：<https://github.com/kkkgo/PaoPaoDNS>
