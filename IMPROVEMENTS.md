# PaoPaoDNS-WebUI 改进建议

> 基于对上游 PaoPaoDNS (https://github.com/kkkgo/PaoPaoDNS) 和当前 WebUI 项目的深入分析，按优先级排列的改进方向及实施细节。

---

## 项目现状概要

- **架构**：React 19 + Vite 8 前端，Flask + Gunicorn 后端，sidecar 模式通过共享 `/data` 卷与 PaoPaoDNS 交互
- **已完成**：6 个页面（概览/环境变量/域名列表/部署生成/TTL规则/高级配置），dark/light 主题，Token 认证，文件白名单，原路径安全写入 + `.bak` 备份回滚，Vite API 代理，hash 深链导航，移动端基础响应式
- **交互方式**：仅通过读写 `/data` 目录下的 9 个白名单文件，不使用 Docker socket/CLI
- **上游数据源（未利用）**：Redis (`/tmp/redis.sock`)、`unbound-control`、`dig` 命令、`test.sh`/`debug.sh` 脚本

---

## 交接校验记录（2026-06-11）

本文件已按当前工作区代码重新核对：

| 原条目 | 校验结论 | 后续建议 |
|---|---|---|
| #1 DNS 实时统计面板 | 未实现 | 仍建议作为高优先级，但需要确认 WebUI 容器是否能访问 PaoPaoDNS 容器内的 `/tmp/redis.sock` 和 `unbound-control`，当前 sidecar 架构默认只能共享 `/data` |
| #2 DNS 测试/诊断功能 | 已实现 MVP | 已新增 `/api/dns-test`、`/api/health-check` 和 Overview 诊断面板；使用 Python 标准库发 UDP DNS 查询，不依赖 `dig` |
| #3 React Router | 部分需求已满足 | 当前 `App.tsx` 已用 hash + `hashchange` 支持深链和浏览器前进/后退；是否引入 React Router 只剩维护性取舍 |
| #4 Vite 代理配置 | 已实现 | `web/vite.config.ts` 已配置 `/api` 代理到 `http://127.0.0.1:8080`，不再列入后续开发待办 |
| #5 后端内容验证 | 已实现 | 已在 `PUT /api/file/<filename>` 写入前校验字符串类型、NUL 字符、文件大小、`custom_env.ini`、`custom_mod.yaml`、TTL 规则、域名列表和 Tracker URL |
| #6 移动端响应式布局 | 已实现基础版 | `web/src/index.css` 已有多处媒体查询；后续可做真机/浏览器截图验收，而不是从零添加 |
| #7 DeployPage 完整部署配置 | 未实现 | 当前页面生成的 compose/run 仍只包含 PaoPaoDNS 主容器，未包含 WebUI sidecar |
| #8 自动化测试 | 已实现后端基础覆盖 | 已新增 Flask test client 测试，覆盖鉴权、白名单、内容类型、内容验证、备份写入、文件大小限制和 DNS 诊断 API；前端测试可后置 |

---

## 1. DNS 实时统计面板 [高优先级]

### 目标
在 Overview 页面添加实时 DNS 缓存统计和服务状态指标，让用户直观感知 WebUI 的价值。

### 上游可利用的数据源

| 数据源 | 访问方式 | 可获取数据 |
|---|---|---|
| Redis | `redis-cli -s /tmp/redis.sock info` | 缓存键数量、命中率、内存使用、连接数、运行时间 |
| Redis | `redis-cli -s /tmp/redis.sock dbsize` | 当前缓存条目数 |
| Redis | `redis-cli -s /tmp/redis.sock info stats` | 总命令数、命中率计算 |
| Unbound | `unbound-control -c /tmp/unbound_raw.conf stats` | 查询数、缓存命中率、递归查询数 |
| Unbound | `unbound-control -c /tmp/unbound_raw.conf list_local_zones` | 本地区域列表 |
| 进程 | `ps -ef \| grep -E 'mosdns\|unbound\|dnscrypt\|redis'` | 各组件运行状态 |

### 后端实现

**架构前置条件**：
- 当前 WebUI sidecar 只共享 `/data`，默认访问不到 PaoPaoDNS 容器内的 `/tmp/redis.sock`、`/tmp/unbound_raw.conf`、`unbound-control` 证书和进程列表。
- 当前 `web/Dockerfile` 的运行镜像只安装 Python 依赖，没有 `redis-cli`、`unbound-control`、`dig`、`pgrep` 等命令。
- 因此该功能不能直接照搬下面的示例代码落地。可选路径：
  - 在 compose 中额外挂载 PaoPaoDNS 运行时 socket/配置文件，并在 WebUI 镜像安装必要命令。
  - 将统计能力放在 PaoPaoDNS 主容器内暴露受限 API，再由 WebUI 调用。
  - 只做网络可达的健康指标，例如从 WebUI 容器访问 `paopaodns:53` 做 DNS 查询，不读取 Redis/Unbound 内部状态。

在 `web/backend/app.py` 中新增 API：

```python
# 需新增的环境变量/配置
REDIS_SOCKET = "/tmp/redis.sock"

@app.route("/api/stats")
def api_stats():
    """DNS 缓存统计和组件运行状态"""
    result = {
        "redis": _get_redis_stats(),
        "unbound": _get_unbound_stats(),
        "processes": _get_process_status(),
    }
    return jsonify(result)

def _get_redis_stats() -> dict:
    """从 Redis 获取缓存统计"""
    try:
        import subprocess
        output = subprocess.run(
            ["redis-cli", "-s", REDIS_SOCKET, "info", "memory", "stats", "keyspace"],
            capture_output=True, text=True, timeout=5
        )
        # 解析 output，提取：
        # used_memory_human - 内存使用
        # keyspace_hits / keyspace_misses - 命中/未命中
        # db0:keys=X,expires=Y - 缓存条目数
        # uptime_in_seconds - 运行时间
        return _parse_redis_info(output.stdout)
    except Exception as e:
        return {"error": str(e), "available": False}

def _get_unbound_stats() -> dict:
    """从 unbound-control 获取统计"""
    try:
        import subprocess
        output = subprocess.run(
            ["unbound-control", "-c", "/tmp/unbound_raw.conf", "stats"],
            capture_output=True, text=True, timeout=5
        )
        # 解析：total.queries, total.cachehits, total.recursivereplies 等
        return _parse_unbound_stats(output.stdout)
    except Exception as e:
        return {"error": str(e), "available": False}

def _get_process_status() -> dict:
    """获取各组件进程状态"""
    import subprocess
    components = ["mosdns", "unbound", "dnscrypt-proxy", "redis-server"]
    result = {}
    for comp in components:
        try:
            r = subprocess.run(
                ["pgrep", "-x", comp],
                capture_output=True, text=True, timeout=3
            )
            result[comp] = {"running": r.returncode == 0, "pid": r.stdout.strip() or None}
        except Exception:
            result[comp] = {"running": False, "pid": None}
    return result
```

**注意事项**：
- Redis socket 路径 `/tmp/redis.sock` 是上游硬编码的，见上游 `redis.conf`
- Unbound 配置路径为 `/tmp/unbound_raw.conf` 和 `/tmp/unbound_forward.conf`（上游 init.sh 生成到 /tmp）
- `unbound-control` 需要上游的 `ubcontrol.key`/`ubcontrol.pem`，这些在 init.sh 中自动生成
- 请求超时要短（3-5s），避免组件无响应时拖慢整个 API

### 前端实现

在 `OverviewPage.tsx` 的概览区域新增统计卡片：

```
┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
│  缓存条目    │ │  命中率      │ │  内存使用    │ │  运行时间    │
│  12,847     │ │  94.2%      │ │  128MB      │ │  3d 12h     │
└─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘

组件状态：
● MosDNS      运行中  PID 42
● Unbound     运行中  PID 58
● DNSCrypt    运行中  PID 71
● Redis       运行中  PID 33
```

- 添加 5-10s 自动刷新（可配置/暂停）
- 组件异常时显示红色警告
- 在 `api.ts` 中添加 `getStats()` 方法
- 在 `types.ts` 中添加 `DnsStats` 类型

---

## 2. DNS 测试/诊断功能 [已完成 MVP]

### 目标
将上游的 `test.sh`、`debug.sh` 功能部分搬到 WebUI，用户无需 `docker exec` 即可诊断。

### 实现状态

- 后端已新增 `POST /api/dns-test`，支持 `A` / `AAAA` / `CNAME` 查询。
- 后端已新增 `GET /api/health-check`，内置 CN/非 CN 域名快速检查。
- 查询目标支持 `DNS_TEST_SERVER`、`DNS_TEST_PORT`、`DNS_TEST_TIMEOUT` 环境变量，默认适配 compose service name `paopaodns:53`。
- 实现使用 Python 标准库构造 UDP DNS 查询和解析响应，不依赖 `dig`，也不需要在镜像中安装 `bind-tools`。
- Overview 页面已加入 DNS 诊断面板，支持自定义域名、记录类型、DNS 服务和端口。

**安全注意**：
- 域名、记录类型、DNS 服务和端口都在后端校验。
- 不执行 shell 命令，避免命令注入面。
- UDP 查询使用短超时，失败时返回结构化错误。
- 该 MVP 只做网络可达诊断，不读取 Redis/Unbound 内部状态。

---

## 3. 路由封装：是否引入 React Router [低优先级/可选]

### 目标
当前 `App.tsx` 已经使用 hash URL 与 `hashchange` 同步页面状态，浏览器前进/后退和 `#/env`、`#/lists` 等深链已经可用。

引入 React Router 的价值主要是减少手写路由逻辑、统一导航 active 状态和后续扩展子路由；它不再是修复深链能力的必要项。

### 实施方案

```bash
npm install react-router-dom
```

修改 `App.tsx`：

```tsx
import { HashRouter, Routes, Route, NavLink } from 'react-router-dom';

// 使用 HashRouter（兼容 SPA 部署，不需要后端路由 fallback）
// 路由映射：
// /#/ → OverviewPage
// /#/env → EnvConfigPage
// /#/lists → DomainListPage
// /#/deploy → DeployPage
// /#/ttl → TtlRulesPage
// /#/advanced → AdvancedConfigPage

// 侧边栏导航改用 NavLink，自动获得 active 类名
// 移除 useState<Page> 和 setActivePage
```

**选择 HashRouter 而非 BrowserRouter 的原因**：
- 当前 Flask 的 catch-all 路由 `@app.route("/<path:path>")` 已能服务 SPA 静态入口
- HashRouter 不需要后端配置 fallback，变更风险最小
- BrowserRouter 可行，但需要完整回归 `/api/*` 路由和静态资源路径

---

## 4. 开发体验：Vite 代理配置 [已完成]

### 校验结论
当前 `web/vite.config.ts` 已经配置 API 代理，本地开发时 `npm run dev` 会把 `/api/*` 转发到后端 `http://127.0.0.1:8080`。

当前配置：

修改 `web/vite.config.ts`：

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      },
    },
  },
})
```

这样开发时 `npm run dev` 会自动将 `/api/*` 请求代理到后端，无需 CORS 配置。

---

## 5. 后端内容验证 [已完成]

### 校验结论
`PUT /api/file/<filename>` 已在写入前做后端内容验证，不再完全信任前端。

当前覆盖：

- 非字符串 `content` 直接返回 400。
- 单文件大小超限返回 413。
- `custom_env.ini` 校验 `KEY="VALUE"` 格式。
- `custom_mod.yaml` 使用 PyYAML 校验 YAML 语法和顶层对象。
- 域名列表校验 `domain:` / `full:` / `regexp:` / `keyword:` 或裸域名规则。
- `force_ttl_rules.txt` 校验 `@` / `@@` / `@@@` 规则分隔符。
- `trackerslist.txt` 校验 Tracker URL scheme 和 host。

**注意**：
- 当前写入实现是“原路径写入 + `.bak` 备份 + 失败回滚”，不是 rename 型原子替换；示例或文案里避免继续称为 atomic write。
- 后端基础测试已加入 `web/backend/tests/test_app.py`。

---

## 6. 移动端响应式布局 [已完成基础版]

### 校验结论
当前 `web/src/index.css` 已经包含多个响应式断点，`max-width: 768px` 下侧边栏会变成顶部横向导航，表单和卡片也会切换为单列布局。

后续只建议做验收和细节补齐：

- 用浏览器分别检查 375px、768px、1024px、1440px。
- 重点看 DeployPage 的端口行、环境变量行和长命令预览是否溢出。
- 如需进一步优化，再补移动端底部/顶部导航交互，而不是重复添加基础媒体查询。

---

## 7. DeployPage 生成完整部署配置 [低优先级]

### 问题
当前部署生成器只产出 PaoPaoDNS 容器配置，不包含 WebUI sidecar。

### 实施方案

在 `DeployPage.tsx` 中添加选项：

- 勾选 "包含 WebUI 管理面板" 时，compose 输出增加 sidecar service
- compose 输出示例：

```yaml
services:
  paopaodns:
    image: sliamb/paopaodns:latest
    # ... 现有配置不变 ...

  paopaodns-web:
    image: ghcr.io/lovest20018/paopaodns-webui:latest
    container_name: PaoPaoDNS-Web
    restart: always
    volumes:
      - paopaodns-data:/data       # 与 PaoPaoDNS 共享卷
    environment:
      - WEB_UI_TOKEN=your-secure-token
      - TZ=${TZ}
      - CNAUTO=${CNAUTO}
      - CNFALL=${CNFALL}
      - IPV6=${IPV6}
      - CN_TRACKER=${CN_TRACKER}
      - USE_MARK_DATA=${USE_MARK_DATA}
      - CUSTOM_FORWARD=${CUSTOM_FORWARD}
      - RULES_TTL=${RULES_TTL}
    ports:
      - "127.0.0.1:8080:8080"
    depends_on:
      - paopaodns
```

在 `generators.ts` 的 `generateDockerCompose()` 中添加 web service 块，并在前端添加 WebUI Token 输入框和端口映射配置。

---

## 8. 自动化测试 [后端基础覆盖已完成]

### 后端测试

当前已在 `web/backend/tests/test_app.py` 添加 Flask test client 覆盖：

- 未认证请求返回 401。
- Bearer token 认证成功。
- 白名单外文件返回 403。
- 非字符串 content 返回 400。
- `custom_env.ini`、`custom_mod.yaml`、TTL 规则、域名列表、Tracker URL 的失败校验。
- 有效写入落盘并生成 `.bak`。
- 单文件大小超限返回 413。

验证命令：

```bash
python -m pytest web/backend/tests
```

当前结果：`15 passed`。

### 前端测试

暂不强制，可后续添加 Vitest + React Testing Library，优先覆盖 DeployPage 生成器和 DNS 诊断交互。

---

## 实施顺序建议

```
Phase 1（核心价值提升）:
  ├── 先确认统计/诊断的容器访问边界（/tmp socket、命令依赖、网络目标）
  ├── #2 DNS 测试/诊断功能（网络可达版已完成）
  └── #1 DNS 实时统计面板（确认可访问 Redis/Unbound 后再做内部指标）

Phase 2（体验优化）:
  ├── #5 后端内容验证（已完成）
  ├── #7 DeployPage 完整配置
  └── #8 自动化测试（后端基础覆盖已完成，前端可后置）

Phase 3（锦上添花）:
  ├── #3 React Router（可选维护性优化）
  └── #6 移动端响应式验收和细节补齐
```

---

## 附录：上游关键路径参考

| 路径 | 说明 |
|---|---|
| `/tmp/redis.sock` | Redis Unix socket（上游 redis.conf 固定） |
| `/tmp/unbound_raw.conf` | Unbound raw 递归配置（init.sh 生成） |
| `/tmp/unbound_forward.conf` | Unbound forward 配置（init.sh 生成） |
| `/tmp/ubcontrol.key` | unbound-control 密钥（init.sh 自动生成） |
| `/tmp/ubcontrol.pem` | unbound-control 证书（init.sh 自动生成） |
| `/tmp/mosdns.yaml` | MosDNS 运行时配置（init.sh 从 /data 模板生成） |
| `/tmp/dnscrypt.toml` | DNSCrypt 运行时配置 |
| `/data/custom_env.ini` | 热重载环境变量覆盖（inotify 监听） |
| `/data/redis_dns_v2.rdb` | Redis 持久化文件 |

上游内存自动缩放规则（init.sh 中）：

| 容器内存 | Unbound 线程 | Redis MaxMemory | MosDNS Cache |
|---|---|---|---|
| <500MB | 1 | 16MB | 1024 |
| 500MB-2GB | 9 | 100MB | 1024 |
| 2-2.5GB | 2 | 450MB | 10240 |
| 2.5-4GB | 2 | 750MB | 10240 |
| 4-6GB | 4 | 900MB | 10240 |
| 6-8GB | 4 | 1500MB | 102400 |
| 8-12GB | 6 | 1800MB | 102400 |
| 12-16GB | 8 | 3000MB | 102400 |
| >16GB | 12 | 4500MB | 1024000 |
