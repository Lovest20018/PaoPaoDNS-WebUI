import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import { useToast } from '../hooks';
import { generateCustomEnvIni, generateCustomModYaml, copyToClipboard, downloadFile } from '../generators';
import { Plus, X, Copy, Download, FileCode, FileText, Save, CheckCircle, AlertCircle, RefreshCw, AlertTriangle } from 'lucide-react';
import type { CustomModZone, CustomModSwap, CustomModHost, CustomEnvEntry } from '../types';
import YAML from 'yaml';

type SubTab = 'custom_env' | 'custom_mod' | 'unbound_custom';

function parseCustomEnv(content: string): CustomEnvEntry[] {
  const entries: CustomEnvEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      // Check if it's a commented-out variable
      const uncommented = trimmed.replace(/^#+\s*/, '');
      const match = uncommented.match(/^([_a-zA-Z0-9]+)="(.*)"$/);
      if (match) {
        entries.push({ key: match[1], value: match[2], enabled: false });
      }
      continue;
    }
    const match = trimmed.match(/^([_a-zA-Z0-9]+)="(.*)"$/);
    if (match) {
      entries.push({ key: match[1], value: match[2], enabled: true });
    }
  }
  return entries;
}

interface CustomModParseResult {
  zones: CustomModZone[];
  swaps: CustomModSwap[];
  hosts: CustomModHost[];
  visualSafe: boolean;
}

const CUSTOM_MOD_KEYS = new Set(['Zones', 'Swaps', 'Hosts']);

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseCustomModYaml(content: string): CustomModParseResult {
  const emptyResult: CustomModParseResult = { zones: [], swaps: [], hosts: [], visualSafe: true };
  if (!content.trim()) return emptyResult;

  try {
    const parsed = YAML.parse(content);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyResult;

    const keys = Object.keys(parsed as Record<string, unknown>);
    const visualSafe = keys.every((key) => CUSTOM_MOD_KEYS.has(key));
    if (!visualSafe) return { ...emptyResult, visualSafe: false };

    const data = parsed as Record<string, unknown>;
    const zones = Array.isArray(data.Zones)
      ? data.Zones.map((item: unknown): CustomModZone => {
          const record = asRecord(item);
          return {
            zone: String(record.zone ?? ''),
            dns: String(record.dns ?? ''),
            ttl: Number(record.ttl ?? 0) || 0,
            seq: record.seq === 'top6' || record.seq === 'list' ? record.seq : 'top',
            socks5: record.socks5 === 'yes' ? 'yes' : 'no',
          };
        })
      : [];
    const swaps = Array.isArray(data.Swaps)
      ? data.Swaps.map((item: unknown): CustomModSwap => {
          const record = asRecord(item);
          return {
            env_key: String(record.env_key ?? ''),
            cidr_file: String(record.cidr_file ?? ''),
          };
        })
      : [];
    const hosts = Array.isArray(data.Hosts)
      ? data.Hosts.map((item: unknown): CustomModHost => {
          const record = asRecord(item);
          return {
            env_key: String(record.env_key ?? ''),
            zone: String(record.zone ?? ''),
          };
        })
      : [];

    return { zones, swaps, hosts, visualSafe: true };
  } catch {
    return { ...emptyResult, visualSafe: false };
  }
}

export default function AdvancedConfigPage() {
  const {
    customEnvEntries, addCustomEnv, removeCustomEnv, updateCustomEnv,
    setCustomModZones, setCustomModSwaps, setCustomModHosts,
    customModZones, addCustomModZone, removeCustomModZone, updateCustomModZone,
    customModSwaps, addCustomModSwap, removeCustomModSwap, updateCustomModSwap,
    customModHosts, addCustomModHost, removeCustomModHost, updateCustomModHost,
  } = useStore();

  const { showToast, ToastComponent } = useToast();
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('custom_env');
  const [unboundContent, setUnboundContent] = useState('');
  const [customModContent, setCustomModContent] = useState('');
  const [customModDirty, setCustomModDirty] = useState(false);
  const [customModVisualSafe, setCustomModVisualSafe] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; msg: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedFromServer, setLoadedFromServer] = useState<Record<SubTab, boolean>>({
    custom_env: false,
    custom_mod: false,
    unbound_custom: false,
  });
  const loadFileRef = useRef<(tab: SubTab) => Promise<void>>(async () => {});

  const loadFile = async (tab: SubTab) => {
    const filename = tab === 'custom_env' ? 'custom_env.ini' : tab === 'custom_mod' ? 'custom_mod.yaml' : 'unbound_custom.conf';
    setLoading(true);
    try {
      const result = await api.readFile(filename);
      const content = result.content || '';

      if (tab === 'unbound_custom') {
        setUnboundContent(content);
      } else if (tab === 'custom_mod') {
        setCustomModContent(content);
        setCustomModDirty(false);
        const parsed = parseCustomModYaml(content);
        setCustomModVisualSafe(parsed.visualSafe);
        setCustomModZones(parsed.zones);
        setCustomModSwaps(parsed.swaps);
        setCustomModHosts(parsed.hosts);
        if (!parsed.visualSafe) {
          showToast('custom_mod.yaml 含有暂不支持的结构，已切换为只保留原文保存');
        }
      } else {
        // Parse custom_env.ini into entries
        const parsed = parseCustomEnv(content);
        // Always replace local entries with the file content, even when it is empty.
        const store = useStore.getState();
        store.setCustomEnvEntries(parsed);
      }
      setLoadedFromServer(prev => ({ ...prev, [tab]: true }));
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      if (!message.includes('not found') && !message.includes('404')) {
        showToast(`读取 ${filename} 失败: ${message}`);
      }
      setLoadedFromServer(prev => ({ ...prev, [tab]: true }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFileRef.current = loadFile;
  });

  useEffect(() => {
    if (loadedFromServer[activeSubTab]) return;
    const timer = window.setTimeout(() => {
      void loadFileRef.current(activeSubTab);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSubTab, loadedFromServer]);

  const hasCustomModVisualEntries = customModZones.length > 0 || customModSwaps.length > 0 || customModHosts.length > 0;
  const getCustomModOutput = () => {
    if (!customModVisualSafe) return customModContent;
    if (!customModDirty) return customModContent;
    return hasCustomModVisualEntries ? generateCustomModYaml() : '';
  };

  const addZone = () => {
    setCustomModDirty(true);
    addCustomModZone({ zone: '', dns: '', ttl: 0, seq: 'top', socks5: 'no' });
  };

  const updateZone = (index: number, zone: CustomModZone) => {
    setCustomModDirty(true);
    updateCustomModZone(index, zone);
  };

  const removeZone = (index: number) => {
    setCustomModDirty(true);
    removeCustomModZone(index);
  };

  const addSwap = () => {
    setCustomModDirty(true);
    addCustomModSwap({ env_key: '', cidr_file: '' });
  };

  const updateSwap = (index: number, swap: CustomModSwap) => {
    setCustomModDirty(true);
    updateCustomModSwap(index, swap);
  };

  const removeSwap = (index: number) => {
    setCustomModDirty(true);
    removeCustomModSwap(index);
  };

  const addHost = () => {
    setCustomModDirty(true);
    addCustomModHost({ env_key: '', zone: '' });
  };

  const updateHost = (index: number, host: CustomModHost) => {
    setCustomModDirty(true);
    updateCustomModHost(index, host);
  };

  const removeHost = (index: number) => {
    setCustomModDirty(true);
    removeCustomModHost(index);
  };

  const getActiveOutput = (): { filename: string; content: string } => {
    if (activeSubTab === 'custom_env') {
      return { filename: 'custom_env.ini', content: generateCustomEnvIni() };
    }
    if (activeSubTab === 'custom_mod') {
      return { filename: 'custom_mod.yaml', content: getCustomModOutput() };
    }
    return { filename: 'unbound_custom.conf', content: unboundContent };
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const { filename, content } = getActiveOutput();
      const result = await api.writeFile(filename, content);
      let msg: string;
      if (result.watched_now) {
        msg = '已保存，将自动热重载';
      } else if (result.requires_reload) {
        msg = '已保存。Web UI 仅写入文件，不控制容器。请在宿主机执行 docker exec paopaodns reload.sh 或重启容器';
      } else if (result.requires_restart) {
        msg = '已保存。需重启 PaoPaoDNS 容器生效';
      } else if (result.condition) {
        msg = `已保存，但当前不会自动热重载 (${result.condition})`;
      } else {
        msg = '已保存';
      }
      setSaveResult({ success: true, msg });
      if (activeSubTab === 'custom_mod') {
        setCustomModContent(content);
        setCustomModDirty(false);
      }
      showToast('配置已保存');
    } catch (e: unknown) {
      setSaveResult({ success: false, msg: getErrorMessage(e) || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleCopyOutput = async () => {
    const { content } = getActiveOutput();
    await copyToClipboard(content);
    showToast('已复制到剪贴板');
  };

  const handleDownloadOutput = () => {
    const { filename, content } = getActiveOutput();
    downloadFile(content, filename);
    showToast('文件已下载');
  };

  return (
    <div>
      <div className="page-header">
        <h2>高级配置</h2>
        <p>
          编辑 custom_env.ini（运行时覆盖变量）、custom_mod.yaml（自定义 Zones/Swaps/Hosts）
          和 unbound_custom.conf（Unbound 自定义配置）。保存后写入 /data 目录。
        </p>
      </div>

      <div className="stack-actions" style={{ marginBottom: 16 }}>
        <span className="summary-chip">ENV {customEnvEntries.length}</span>
        <span className="summary-chip">Zones {customModZones.length}</span>
        <span className="summary-chip">Swaps {customModSwaps.length}</span>
        <span className="summary-chip">Hosts {customModHosts.length}</span>
      </div>

      <div className="tab-bar">
        <button className={`tab-item ${activeSubTab === 'custom_env' ? 'active' : ''}`} onClick={() => setActiveSubTab('custom_env')}>
          <FileText size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> custom_env.ini
        </button>
        <button className={`tab-item ${activeSubTab === 'custom_mod' ? 'active' : ''}`} onClick={() => setActiveSubTab('custom_mod')}>
          <FileCode size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> custom_mod.yaml
        </button>
        <button className={`tab-item ${activeSubTab === 'unbound_custom' ? 'active' : ''}`} onClick={() => setActiveSubTab('unbound_custom')}>
          <FileCode size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> unbound_custom.conf
        </button>
      </div>

      {loading && (
        <div className="loading-panel">
          <div className="loading-card" style={{ color: 'var(--text-muted)' }}>
            <RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> 加载中...
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        </div>
      )}

      {activeSubTab === 'custom_env' && (
        <div className="form-panel">
          <div className="card-title">
            custom_env.ini — 运行时变量覆盖
            <span className="badge badge-green" style={{ marginLeft: 8 }}>自动热重载</span>
          </div>
          <div className="card-desc">
            在此定义的变量会覆盖 Docker 启动时的环境变量，修改后 MosDNS 会自动重载。格式：key="value"
          </div>

          {customEnvEntries.map((entry, i) => (
            <div className="domain-entry" key={i} style={{ marginBottom: 8 }}>
              <input className="form-input" style={{ width: 180, flexShrink: 0 }} type="text" value={entry.key} placeholder="VARIABLE_NAME" onChange={(e) => updateCustomEnv(i, { ...entry, key: e.target.value })} />
              <input className="form-input" type="text" value={entry.value} placeholder="value" onChange={(e) => updateCustomEnv(i, { ...entry, value: e.target.value })} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                <input type="checkbox" checked={entry.enabled} onChange={(e) => updateCustomEnv(i, { ...entry, enabled: e.target.checked })} />启用
              </label>
              <button className="domain-remove-btn" onClick={() => removeCustomEnv(i)}><X size={16} /></button>
            </div>
          ))}

          <div className="inline-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => addCustomEnv({ key: '', value: '', enabled: true })}><Plus size={14} /> 添加变量</button>
          </div>

          <div style={{ marginTop: 20, borderTop: '1px solid var(--border-color)', paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>生成预览</div>
            <div className="preview-shell command-box"><div className="code-content" style={{ padding: 12, fontSize: 12 }}>{generateCustomEnvIni()}</div></div>
          </div>
        </div>
      )}

      {activeSubTab === 'custom_mod' && (
        <>
          <div className="form-panel" style={{ borderColor: 'var(--accent-amber)' }}>
            <div style={{ fontSize: 13, color: 'var(--accent-amber)', marginBottom: 8 }}>
              <AlertTriangle size={16} style={{ display: 'inline', verticalAlign: 'middle' }} />
              custom_mod.yaml 保存后不会自动生效。Web UI 仅写入文件，不控制 PaoPaoDNS 容器。
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              保存后请在宿主机执行以下命令使配置生效：
            </div>
            <div className="code-block" style={{ marginTop: 8 }}>
              <div className="code-header">
                <span>reload 命令</span>
                <button className="code-copy-btn" onClick={async () => {
                  await navigator.clipboard.writeText('docker exec paopaodns reload.sh');
                  showToast('命令已复制');
                }}><Copy size={12} /> 复制</button>
              </div>
              <div className="code-content">docker exec paopaodns reload.sh</div>
            </div>
          </div>

          <div className="form-panel">
            <div className="card-title">Zones — 自定义域名区域转发</div>
            <div className="card-desc">定义域名区域转发到指定 DNS 服务器，seq=top 最高优先级，seq=list 在列表之后匹配。</div>
            {!customModVisualSafe && (
              <div className="card-desc" style={{ marginBottom: 12, color: 'var(--accent-amber)' }}>
                当前 custom_mod.yaml 含有暂不支持的 YAML 结构。保存/复制/下载会保留原文，下面的可视化表单不会写回文件。
              </div>
            )}
            {customModZones.map((zone, i) => (
              <div key={i} style={{ marginBottom: 12, padding: 12, background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">域名/区域</label><input className="form-input" type="text" value={zone.zone} placeholder="company.local" onChange={(e) => updateZone(i, { ...zone, zone: e.target.value })} /></div>
                  <div className="form-group"><label className="form-label">DNS 服务器</label><input className="form-input" type="text" value={zone.dns} placeholder="udp://10.10.10.3:53" onChange={(e) => updateZone(i, { ...zone, dns: e.target.value })} /></div>
                </div>
                <div className="form-row">
                  <div className="form-group"><label className="form-label">TTL</label><input className="form-input" type="number" value={zone.ttl} min={0} onChange={(e) => updateZone(i, { ...zone, ttl: parseInt(e.target.value) || 0 })} /></div>
                  <div className="form-group"><label className="form-label">优先级 (seq)</label><select className="form-select" value={zone.seq} onChange={(e) => updateZone(i, { ...zone, seq: e.target.value as CustomModZone['seq'] })}><option value="top">top</option><option value="top6">top6</option><option value="list">list</option></select></div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input type="checkbox" checked={zone.socks5 === 'yes'} onChange={(e) => updateZone(i, { ...zone, socks5: e.target.checked ? 'yes' : 'no' })} />走 SOCKS5
                  </label>
                  <button className="btn btn-danger btn-sm" onClick={() => removeZone(i)}><X size={14} /> 删除</button>
                </div>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" disabled={!customModVisualSafe} onClick={addZone}><Plus size={14} /> 添加 Zone</button>
          </div>

          <div className="form-panel">
            <div className="card-title">Swaps — IP/CIDR 段替换</div>
            {customModSwaps.map((swap, i) => (
              <div className="domain-entry" key={i} style={{ marginBottom: 8 }}>
                <input className="form-input" style={{ width: 180, flexShrink: 0 }} type="text" value={swap.env_key} placeholder="env_key" onChange={(e) => updateSwap(i, { ...swap, env_key: e.target.value })} />
                <input className="form-input" type="text" value={swap.cidr_file} placeholder="/data/test_cidr.txt" onChange={(e) => updateSwap(i, { ...swap, cidr_file: e.target.value })} />
                <button className="domain-remove-btn" onClick={() => removeSwap(i)}><X size={16} /></button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" disabled={!customModVisualSafe} onClick={addSwap}><Plus size={14} /> 添加 Swap</button>
          </div>

          <div className="form-panel">
            <div className="card-title">Hosts — 域名直接映射</div>
            {customModHosts.map((host, i) => (
              <div className="domain-entry" key={i} style={{ marginBottom: 8 }}>
                <input className="form-input" style={{ width: 180, flexShrink: 0 }} type="text" value={host.env_key} placeholder="env_key" onChange={(e) => updateHost(i, { ...host, env_key: e.target.value })} />
                <input className="form-input" type="text" value={host.zone} placeholder="a.com domain:b.com" onChange={(e) => updateHost(i, { ...host, zone: e.target.value })} />
                <button className="domain-remove-btn" onClick={() => removeHost(i)}><X size={16} /></button>
              </div>
            ))}
            <button className="btn btn-secondary btn-sm" disabled={!customModVisualSafe} onClick={addHost}><Plus size={14} /> 添加 Host</button>
          </div>

          <div className="form-panel">
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-secondary)' }}>生成预览</div>
            <div className="preview-shell command-box"><div className="code-content" style={{ padding: 12, fontSize: 12 }}>{getCustomModOutput()}</div></div>
          </div>
        </>
      )}

      {activeSubTab === 'unbound_custom' && (
        <div className="form-panel">
          <div className="card-title">
            unbound_custom.conf — Unbound 自定义配置
            <span className="badge badge-amber" style={{ marginLeft: 8 }}>需重启容器</span>
          </div>
          <div className="card-desc">添加 SRV 记录等高级配置。修改后需重启 PaoPaoDNS 容器生效。</div>
          <textarea className="textarea-code" value={unboundContent} onChange={(e) => setUnboundContent(e.target.value)} rows={12} />
        </div>
      )}

      <div className="stack-actions" style={{ marginTop: 18 }}>
        <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
          <Save size={16} /> {saving ? '保存中...' : '保存到 /data'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={handleCopyOutput}><Copy size={14} /> 复制</button>
        <button className="btn btn-secondary btn-sm" onClick={handleDownloadOutput}><Download size={14} /> 下载</button>
        {saveResult && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            {saveResult.success ? (
              <><CheckCircle size={14} style={{ color: 'var(--accent-green)' }} /> <span style={{ color: 'var(--accent-green)' }}>{saveResult.msg}</span></>
            ) : (
              <><AlertCircle size={14} style={{ color: 'var(--accent-red)' }} /> <span style={{ color: 'var(--accent-red)' }}>{saveResult.msg}</span></>
            )}
          </span>
        )}
      </div>

      {ToastComponent}
    </div>
  );
}
