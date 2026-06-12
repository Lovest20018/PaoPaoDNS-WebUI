import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import {
  Activity, Shield, Globe, Database,
  RefreshCw, CheckCircle, XCircle, AlertTriangle,
  FileText, HardDrive, Key, Eye, EyeOff, Search, Play, Server
} from 'lucide-react';

const DEFAULT_DNS_TEST_SERVER = 'paopaodns';
const DEFAULT_DNS_TEST_PORT = 53;

export default function OverviewPage() {
  const {
    envValues, filesExist, setConnected, setFilesExist, setEnvValues
  } = useStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dataWritable, setDataWritable] = useState(true);
  const [dataReadable, setDataReadable] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [filesInfo, setFilesInfo] = useState<Record<string, { watched_now: boolean; condition: string }>>({});
  const [tokenInput, setTokenInput] = useState(api.getStoredToken());
  const [tokenVisible, setTokenVisible] = useState(false);
  const [dnsDomain, setDnsDomain] = useState('www.baidu.com');
  const [dnsRecordType, setDnsRecordType] = useState<'A' | 'AAAA' | 'CNAME'>('A');
  const [dnsServer, setDnsServer] = useState(DEFAULT_DNS_TEST_SERVER);
  const [dnsPort, setDnsPort] = useState(String(DEFAULT_DNS_TEST_PORT));
  const [dnsResult, setDnsResult] = useState<api.DnsTestResult | null>(null);
  const [healthResult, setHealthResult] = useState<api.HealthCheckResult | null>(null);
  const [dnsLoading, setDnsLoading] = useState(false);
  const [healthLoading, setHealthLoading] = useState(false);
  const [dnsError, setDnsError] = useState('');
  const loadStatusRef = useRef<() => Promise<void>>(async () => {});
  const dnsTargetTouchedRef = useRef(false);

  const cnAutoEnabled = envValues.CNAUTO === 'yes';

  const loadStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const status = await api.getStatus();
      setConnected(true);
      setFilesExist(status.files);
      setEnvValues(status.env);
      setDataWritable(status.data_writable);
      setDataReadable(status.data_readable);
      setAuthEnabled(status.auth_enabled);
      if (!dnsTargetTouchedRef.current) {
        setDnsServer(status.dns_test?.server || DEFAULT_DNS_TEST_SERVER);
        setDnsPort(String(status.dns_test?.port || DEFAULT_DNS_TEST_PORT));
      }
      // Extract watched_now and condition from files_info
      const info: Record<string, { watched_now: boolean; condition: string }> = {};
      for (const [f, v] of Object.entries(status.files_info)) {
        info[f] = { watched_now: v.watched_now, condition: v.condition };
      }
      setFilesInfo(info);
    } catch (e: unknown) {
      setConnected(false);
      setError(e instanceof Error ? e.message : '无法连接到后端服务');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatusRef.current = loadStatus;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadStatusRef.current();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const handleTokenSave = () => {
    api.setToken(tokenInput);
    loadStatus();
  };

  const parsedDnsPort = () => {
    const value = Number.parseInt(dnsPort, 10);
    return Number.isFinite(value) ? value : undefined;
  };

  const handleDnsServerChange = (value: string) => {
    dnsTargetTouchedRef.current = true;
    setDnsServer(value);
    setDnsResult(null);
    setHealthResult(null);
    setDnsError('');
  };

  const handleDnsPortChange = (value: string) => {
    dnsTargetTouchedRef.current = true;
    setDnsPort(value);
    setDnsResult(null);
    setHealthResult(null);
    setDnsError('');
  };

  const handleDnsLookup = async () => {
    setDnsLoading(true);
    setDnsError('');
    try {
      const result = await api.runDnsTest({
        domain: dnsDomain,
        record_type: dnsRecordType,
        server: dnsServer || undefined,
        port: parsedDnsPort(),
      });
      setDnsResult(result);
    } catch (e: unknown) {
      setDnsError(e instanceof Error ? e.message : 'DNS 查询失败');
    } finally {
      setDnsLoading(false);
    }
  };

  const handleHealthCheck = async () => {
    setHealthLoading(true);
    setDnsError('');
    try {
      const result = await api.runHealthCheck({
        server: dnsServer || undefined,
        port: parsedDnsPort(),
      });
      setHealthResult(result);
    } catch (e: unknown) {
      setDnsError(e instanceof Error ? e.message : '健康检查失败');
    } finally {
      setHealthLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="loading-panel">
        <div className="loading-card">
        <RefreshCw size={24} style={{ color: 'var(--accent-blue)', animation: 'spin 1s linear infinite' }} />
        <span style={{ marginLeft: 12, color: 'var(--text-secondary)' }}>连接 PaoPaoDNS Web UI...</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className="page-header page-header-row">
          <div className="page-header-meta">
          <h2>概览</h2>
          <p>PaoPaoDNS /data 目录状态和配置总览</p>
          </div>
          <div className="page-header-actions">
            <button className="btn btn-secondary btn-sm" onClick={loadStatus}>
              <RefreshCw size={14} /> 刷新
            </button>
          </div>
        </div>
        <div className="card alert-card alert-danger">
          <div className="alert-icon" style={{ background: 'rgba(251, 113, 133, 0.14)', color: 'var(--accent-red)' }}>
            <XCircle size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="alert-title">连接失败</div>
            <div className="alert-desc">{error}</div>
            <div className="alert-desc" style={{ marginTop: 10 }}>
              请确认 PaoPaoDNS 容器和 Web UI 后端服务正在运行。<br />
              docker compose -f docker-compose-web.yaml up -d
            </div>
          </div>
          {error.includes('Unauthorized') && (
            <div className="card alert-info" style={{ marginTop: 18, marginBottom: 16 }}>
              <div className="card-title"><Key size={16} /> Token 验证</div>
              <div className="form-row">
                <div className="form-group" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      className="form-input"
                      type={tokenVisible ? 'text' : 'password'}
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="输入 WEB_UI_TOKEN"
                    />
                    <button className="btn btn-secondary btn-sm" onClick={() => setTokenVisible(!tokenVisible)}>
                      {tokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button className="btn btn-primary btn-sm" onClick={handleTokenSave}>验证</button>
                  </div>
                </div>
              </div>
            </div>
          )}
          <button className="btn btn-primary" onClick={loadStatus} style={{ marginTop: 10 }}>
            <RefreshCw size={16} /> 重新连接
          </button>
        </div>
      </div>
    );
  }

  const fileReloadRows = [
    { file: 'custom_env.ini', desc: '运行时变量覆盖', reloadType: 'auto' as const },
    { file: 'custom_mod.yaml', desc: 'Zones/Swaps/Hosts 自定义', reloadType: 'reload' as const },
    { file: 'force_forward_list.txt', desc: '强制转发域名列表', reloadType: 'conditional' as const },
    { file: 'force_dnscrypt_list.txt', desc: '强制 DNSCrypt 域名列表', reloadType: 'auto' as const },
    { file: 'force_recurse_list.txt', desc: '强制递归域名列表', reloadType: 'auto' as const },
    { file: 'force_ttl_rules.txt', desc: 'TTL 规则', reloadType: 'conditional' as const },
    { file: 'custom_cn_mark.txt', desc: '自定义 CN 域名标记', reloadType: 'conditional' as const },
    { file: 'trackerslist.txt', desc: 'BT Tracker 列表', reloadType: 'conditional' as const },
    { file: 'unbound_custom.conf', desc: 'Unbound 自定义配置', reloadType: 'restart' as const },
    { file: 'redis_dns_v2.rdb', desc: 'Redis DNS 缓存', reloadType: 'managed' as const },
    { file: 'Country-only-cn-private.mmdb', desc: 'CN IP 数据库', reloadType: 'managed' as const },
    { file: 'global_mark.dat', desc: '全球域名标记库', reloadType: 'managed' as const },
  ];

  return (
    <div>
      <div className="page-header overview-header">
        <div>
          <h2>概览</h2>
          <p>PaoPaoDNS /data 目录状态和配置总览</p>
        </div>
        <div className="btn-group">
          <button className="btn btn-secondary btn-sm" onClick={loadStatus}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      {/* Auth Warning */}
      {!authEnabled && (
        <div className="card overview-warning" style={{ borderColor: 'var(--accent-red)' }}>
          <div className="overview-warning-line">
            <XCircle size={16} />
            <strong>鉴权未启用</strong> — WEB_UI_TOKEN 未设置，任何能访问此页面的人都可以修改 DNS 配置。
            请在 docker-compose-web.yaml 中设置 WEB_UI_TOKEN，或在需要无鉴权时显式设置 WEB_UI_ALLOW_NO_AUTH=true。
          </div>
        </div>
      )}

      <div className="overview-top-grid">
        {/* /data Status */}
        <div className="card overview-compact-card" style={{ borderColor: dataReadable ? 'var(--accent-green)' : 'var(--accent-red)' }}>
          <div className="overview-card-line">
            <HardDrive size={18} style={{ color: dataReadable ? 'var(--accent-green)' : 'var(--accent-red)' }} />
            <strong>/data 目录状态</strong>
            <span className={`badge ${dataReadable ? 'badge-green' : 'badge-red'}`}>
              {dataReadable ? '可读' : '不可读'}
            </span>
            <span className={`badge ${dataWritable ? 'badge-green' : 'badge-amber'}`}>
              {dataWritable ? '可写' : '只读'}
            </span>
          </div>
          {!dataWritable && (
            <div className="overview-inline-warning">
              /data 目录为只读，无法保存配置。请检查 volume 挂载权限。
            </div>
          )}
        </div>

        {/* Token Settings */}
        <div className="card overview-compact-card overview-token-card">
          <div className="overview-card-line">
            <Key size={18} />
            <strong>Token 认证</strong>
            <span className={`badge ${authEnabled ? 'badge-green' : 'badge-red'}`}>{authEnabled ? '已启用' : '未启用'}</span>
            <span className="overview-card-note">需要 Token 时在此保存访问凭据</span>
          </div>
          <div className="overview-token-row">
            <input
              className="form-input"
              type={tokenVisible ? 'text' : 'password'}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="WEB_UI_TOKEN"
            />
            <button className="btn btn-secondary btn-sm" onClick={() => setTokenVisible(!tokenVisible)}>
              {tokenVisible ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleTokenSave}>保存</button>
          </div>
        </div>
      </div>

      {/* Config Status Cards */}
      <div className="overview-metric-grid">
        <div className="card overview-metric-card">
          <Shield size={18} style={{ color: cnAutoEnabled ? 'var(--accent-green)' : 'var(--text-muted)' }} />
          <span>CN 智能分流</span>
          <strong style={{ color: cnAutoEnabled ? 'var(--accent-green)' : 'var(--text-muted)' }}>
            {cnAutoEnabled ? '已开启' : '已关闭'}
          </strong>
        </div>
        <div className="card overview-metric-card">
          <Globe size={18} style={{ color: envValues.IPV6 !== 'no' ? 'var(--accent-cyan)' : 'var(--text-muted)' }} />
          <span>IPv6</span>
          <strong style={{ color: envValues.IPV6 !== 'no' ? 'var(--accent-cyan)' : 'var(--text-muted)' }}>
            {envValues.IPV6 === 'no' ? '关闭' : envValues.IPV6}
          </strong>
        </div>
        <div className="card overview-metric-card">
          <Database size={18} style={{ color: 'var(--accent-purple)' }} />
          <span>域名标记库</span>
          <strong style={{ color: envValues.USE_MARK_DATA === 'yes' ? 'var(--accent-purple)' : 'var(--text-muted)' }}>
            {envValues.USE_MARK_DATA === 'yes' ? '开启' : '关闭'}
          </strong>
        </div>
      </div>

      {/* DNS Diagnostics */}
      <div className="card">
        <div className="card-title"><Search size={18} /> DNS 诊断</div>
        <div className="card-desc">对后端配置的目标 DNS 服务执行 A / AAAA / CNAME 查询和 CN/非 CN 健康检查</div>
        <div className="dns-diagnostic-grid">
          <div className="dns-control-panel">
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">域名</label>
                <input
                  className="form-input"
                  value={dnsDomain}
                  onChange={(e) => setDnsDomain(e.target.value)}
                  placeholder="www.baidu.com"
                />
              </div>
              <div className="form-group">
                <label className="form-label">记录类型</label>
                <select
                  className="form-select"
                  value={dnsRecordType}
                  onChange={(e) => setDnsRecordType(e.target.value as 'A' | 'AAAA' | 'CNAME')}
                >
                  <option value="A">A</option>
                  <option value="AAAA">AAAA</option>
                  <option value="CNAME">CNAME</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">DNS 服务</label>
                <input
                  className="form-input"
                  value={dnsServer}
                  onChange={(e) => handleDnsServerChange(e.target.value)}
                  placeholder="paopaodns"
                />
              </div>
              <div className="form-group">
                <label className="form-label">端口</label>
                <input
                  className="form-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={dnsPort}
                  onChange={(e) => handleDnsPortChange(e.target.value)}
                  placeholder="53"
                />
              </div>
            </div>
            <div className="inline-actions">
              <button className="btn btn-primary btn-sm" onClick={handleDnsLookup} disabled={dnsLoading}>
                {dnsLoading ? <RefreshCw size={14} /> : <Search size={14} />} 查询
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handleHealthCheck} disabled={healthLoading}>
                {healthLoading ? <RefreshCw size={14} /> : <Play size={14} />} 健康检查
              </button>
              <span className="summary-chip"><Server size={13} /> {dnsServer || DEFAULT_DNS_TEST_SERVER}:{dnsPort || DEFAULT_DNS_TEST_PORT}</span>
            </div>
            <div className="floating-note">
              默认来自后端 DNS_TEST_SERVER / DNS_TEST_PORT；单独部署时请填写 Web UI 容器可访问的 PaoPaoDNS 地址。
            </div>
            {dnsError && (
              <div className="overview-inline-warning">
                {dnsError}
              </div>
            )}
          </div>

          <div className="dns-result-panel">
            {dnsResult ? (
              <div className="dns-result-block">
                <div className="dns-result-header">
                  <span className={`badge ${dnsResult.available ? 'badge-green' : 'badge-red'}`}>
                    {dnsResult.rcode || (dnsResult.available ? 'OK' : '失败')}
                  </span>
                  <span>{dnsResult.domain}</span>
                  {dnsResult.elapsed_ms !== undefined && <span>{dnsResult.elapsed_ms} ms</span>}
                </div>
                {dnsResult.error && <div className="dns-result-error">{dnsResult.error}</div>}
                <div className="dns-answer-list">
                  {dnsResult.answers.length > 0 ? dnsResult.answers.map((answer, index) => (
                    <div className="dns-answer-row" key={`${answer.name}-${answer.type}-${answer.value}-${index}`}>
                      <span>{answer.type}</span>
                      <code>{answer.value}</code>
                      <small>TTL {answer.ttl}</small>
                    </div>
                  )) : (
                    <div className="floating-note">无应答记录</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="floating-note">尚未执行 DNS 查询</div>
            )}

            {healthResult && (
              <div className="dns-health-block">
                <div className="dns-result-header">
                  <span className={`badge ${healthResult.pass ? 'badge-green' : 'badge-red'}`}>
                    {healthResult.pass ? '健康' : '异常'}
                  </span>
                  <span>{healthResult.server}:{healthResult.port}</span>
                </div>
                <div className="dns-answer-list">
                  {Object.entries(healthResult.tests).map(([key, item]) => (
                    <div className="dns-answer-row" key={key}>
                      <span>{key === 'cn' ? 'CN' : '非 CN'}</span>
                      <code>{item.domain}</code>
                      <small style={{ color: item.resolved ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        {item.resolved ? '已解析' : '失败'}
                      </small>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Architecture Diagram */}
      <div className="card">
        <div className="card-title"><Activity size={18} /> DNS 解析架构</div>
        <div className="card-desc">根据 custom_env.ini 配置的 DNS 请求分流处理流程</div>
        <div className="arch-diagram">
          {cnAutoEnabled ? (
            <div className="arch-flow">
              <div className="arch-node primary">客户端 DNS 请求 :53</div>
              <div className="arch-arrow">&#8595;</div>
              <div className="arch-node primary">mosdns (分流引擎 + Redis 缓存)</div>
              <div className="arch-arrow">&#8595;</div>
              <div className="arch-branches">
                <div className="arch-branch">
                  <div className="arch-branch-label">CN 域名</div>
                  <div className="arch-node green">Unbound :5301 (递归)</div>
                </div>
                <div className="arch-branch">
                  <div className="arch-branch-label">非 CN 域名</div>
                  <div className="arch-node amber">DNSCrypt :5302 (加密)</div>
                  {envValues.SOCKS5 && envValues.SOCKS5.match(/.:\d+/) && (
                    <div className="arch-node amber" style={{ marginTop: 4 }}>+SOCKS5 :5303</div>
                  )}
                </div>
                {envValues.CUSTOM_FORWARD && envValues.CUSTOM_FORWARD.match(/.:\d+/) && (
                  <div className="arch-branch">
                    <div className="arch-branch-label">自定义转发</div>
                    <div className="arch-node purple">{envValues.CUSTOM_FORWARD}</div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="arch-flow">
              <div className="arch-node primary">客户端 DNS 请求 :{envValues.DNSPORT || '53'}</div>
              <div className="arch-arrow">&#8595;</div>
              <div className="arch-node green">Unbound (纯递归 DNS)</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                CNAUTO=no 模式下不经过 mosdns 分流，直接递归查询权威 DNS
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Files Status */}
      <div className="card">
        <div className="card-title"><FileText size={18} /> /data 文件状态</div>
        <div className="card-desc">显示 /data 目录下各配置文件是否存在及其热重载行为</div>
        <table className="info-table">
          <thead>
            <tr><th>文件</th><th>说明</th><th>状态</th><th>重载方式</th></tr>
          </thead>
          <tbody>
            {fileReloadRows.map((row) => {
              const info = filesInfo[row.file];
              const watchedNow = info?.watched_now ?? false;
              const condition = info?.condition ?? '';

              let reloadDisplay: React.ReactNode;
              if (row.reloadType === 'managed') {
                reloadDisplay = <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>自动管理</span>;
              } else if (row.reloadType === 'auto') {
                reloadDisplay = (
                  <span style={{ color: 'var(--accent-green)', fontSize: 12 }}>
                    <CheckCircle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> 自动热重载
                  </span>
                );
              } else if (row.reloadType === 'conditional') {
                reloadDisplay = watchedNow ? (
                  <span style={{ color: 'var(--accent-green)', fontSize: 12 }}>
                    <CheckCircle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> 自动热重载
                  </span>
                ) : (
                  <span style={{ color: 'var(--accent-amber)', fontSize: 12 }}>
                    <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> 未监听{condition && ` (${condition})`}
                  </span>
                );
              } else if (row.reloadType === 'reload') {
                reloadDisplay = (
                  <span style={{ color: 'var(--accent-amber)', fontSize: 12 }}>
                    <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> 需手动 reload
                  </span>
                );
              } else {
                reloadDisplay = (
                  <span style={{ color: 'var(--accent-red)', fontSize: 12 }}>
                    <AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> 需重启容器
                  </span>
                );
              }

              return (
                <tr key={row.file}>
                  <td><code style={{ color: 'var(--accent-cyan)' }}>{row.file}</code></td>
                  <td>{row.desc}</td>
                  <td>
                    {filesExist[row.file] ? (
                      <span className="badge badge-green">存在</span>
                    ) : (
                      <span className="badge badge-red">不存在</span>
                    )}
                  </td>
                  <td>{reloadDisplay}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {envValues.CUSTOM_FORWARD && (
        <div className="card" style={{ borderColor: 'var(--accent-purple)' }}>
          <div className="card-title">自定义转发配置</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            CUSTOM_FORWARD: <code style={{ color: 'var(--accent-cyan)' }}>{envValues.CUSTOM_FORWARD}</code>
            {envValues.CUSTOM_FORWARD_TTL && parseInt(envValues.CUSTOM_FORWARD_TTL) > 0 && (
              <span> | TTL 最小值: <code style={{ color: 'var(--accent-cyan)' }}>{envValues.CUSTOM_FORWARD_TTL}s</code></span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
