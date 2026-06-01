import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import { useToast } from '../hooks';
import { Plus, X, Clock, Save, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

interface TtlRuleEntry {
  id: number;
  domain: string;
  server: string;
  type: 'forward' | 'record' | 'cname';
  matchMode?: 'subdomain' | 'exact';
  record?: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseTtlRules(content: string): TtlRuleEntry[] {
  const entries: TtlRuleEntry[] = [];
  let id = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.includes('@@@')) {
      const [domain, record] = trimmed.split('@@@');
      entries.push({ id: id++, domain: domain.trim(), server: '', type: record.includes('.') && !record.match(/^\d/) ? 'cname' : 'record', matchMode: 'exact', record: record.trim() });
    } else if (trimmed.includes('@@')) {
      const [domain, record] = trimmed.split('@@');
      entries.push({ id: id++, domain: domain.trim(), server: '', type: record.includes('.') && !record.match(/^\d/) ? 'cname' : 'record', matchMode: 'subdomain', record: record.trim() });
    } else if (trimmed.includes('@')) {
      const [domain, serverPart] = trimmed.split('@');
      entries.push({ id: id++, domain: domain.trim(), server: serverPart?.trim() || '', type: 'forward' });
    }
  }
  return entries;
}

function serializeTtlRules(entries: TtlRuleEntry[]): string {
  const lines: string[] = [
    '# TTL 规则配置文件',
    '# 格式: domain@server:port 或 domain@@record',
    '# domain@server:port — 转发到指定DNS服务器',
    '# domain@@IP — 直接指定A/AAAA记录(子域名匹配)',
    '# domain@@@IP — 精确匹配指定A/AAAA记录',
    '# domain@@CNAME — 子域名CNAME到另一域名',
    '# domain@@@CNAME — 精确匹配CNAME到另一域名',
    '',
  ];
  for (const e of entries) {
    if (e.type === 'record' || e.type === 'cname') {
      const separator = e.matchMode === 'exact' ? '@@@' : '@@';
      lines.push(`${e.domain}${separator}${e.record || ''}`);
    } else {
      lines.push(`${e.domain}@${e.server}`);
    }
  }
  return lines.join('\n');
}

export default function TtlRulesPage() {
  const { envValues } = useStore();
  const { showToast, ToastComponent } = useToast();
  const rulesTtl = parseInt(envValues.RULES_TTL || '0');
  const rulesEnabled = rulesTtl > 0;
  const cnAutoEnabled = envValues.CNAUTO === 'yes';

  const [entries, setEntries] = useState<TtlRuleEntry[]>([]);
  const [rawContent, setRawContent] = useState('');
  const [editMode, setEditMode] = useState<'visual' | 'text'>('visual');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; msg: string } | null>(null);
  const loadFileRef = useRef<() => Promise<void>>(async () => {});

  const getCurrentContent = () => editMode === 'visual' ? serializeTtlRules(entries) : rawContent;

  const loadFile = async () => {
    setLoading(true);
    try {
      const result = await api.readFile('force_ttl_rules.txt');
      const content = result.content || '';
      setRawContent(content);
      setEntries(parseTtlRules(content));
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      if (message.includes('not found') || message.includes('404')) {
        setRawContent('');
        setEntries([]);
      } else {
        showToast('读取 force_ttl_rules.txt 失败: ' + message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFileRef.current = loadFile;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFileRef.current();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const addEntry = () => {
    setEntries((prev) => [
      ...prev,
      { id: Date.now(), domain: '', server: '', type: 'forward' },
    ]);
  };

  const switchEditMode = (mode: 'visual' | 'text') => {
    if (mode === editMode) return;
    if (mode === 'visual') {
      setEntries(parseTtlRules(rawContent));
    } else {
      setRawContent(serializeTtlRules(entries));
    }
    setEditMode(mode);
  };

  const updateEntry = (id: number, updates: Partial<TtlRuleEntry>) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  };

  const removeEntry = (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    const content = getCurrentContent();
    try {
      const result = await api.writeFile('force_ttl_rules.txt', content);
      let msg: string;
      if (result.watched_now) {
        msg = '已保存，将自动热重载';
      } else if (result.condition) {
        msg = `已保存，但当前不会自动热重载 (${result.condition})`;
      } else if (result.requires_restart) {
        msg = '已保存，需重启容器';
      } else {
        msg = '已保存';
      }
      setSaveResult({ success: true, msg });
      showToast('配置已保存到 /data');
    } catch (e: unknown) {
      setSaveResult({ success: false, msg: getErrorMessage(e) || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <h2>TTL 规则配置</h2>
        <p>
          配置 force_ttl_rules.txt，将指定域名转发到指定 DNS 服务器并修改 TTL 值。
          适用于 DDNS 域名实时更新、指定域名走特定权威 DNS 等场景。
        </p>
      </div>

      {!cnAutoEnabled && (
        <div className="card" style={{ borderColor: 'var(--accent-amber)' }}>
          <div className="card-desc" style={{ color: 'var(--accent-amber)' }}>
            CNAUTO 未开启，TTL 规则功能不会工作。请在 custom_env.ini 中设置 CNAUTO=yes 或重新创建容器。
          </div>
        </div>
      )}

      {!rulesEnabled && cnAutoEnabled && (
        <div className="card" style={{ borderColor: 'var(--accent-amber)' }}>
          <div className="card-desc" style={{ color: 'var(--accent-amber)' }}>
            RULES_TTL 当前为 0，TTL 规则不会生效。请在 custom_env.ini 中将 RULES_TTL 设为大于 0 的值。
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">
          <Clock size={18} />
          TTL 规则说明
        </div>
        <div className="card-desc">
          RULES_TTL 值大于 0 时生效。规则仅对 A 记录和 AAAA 记录生效。
          保存后将自动热重载生效。容器更新不会覆盖此文件。
        </div>
        <table className="info-table">
          <thead>
            <tr><th>格式</th><th>说明</th><th>示例</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><code style={{ color: 'var(--accent-cyan)' }}>domain@server</code></td>
              <td>转发到指定 DNS 服务器（子域名匹配）</td>
              <td>cncheck.03k.org@129.211.176.224</td>
            </tr>
            <tr>
              <td><code style={{ color: 'var(--accent-cyan)' }}>domain@server:port</code></td>
              <td>转发到指定 DNS 服务器含端口</td>
              <td>cncheck.03k.org@129.211.176.224:53</td>
            </tr>
            <tr>
              <td><code style={{ color: 'var(--accent-cyan)' }}>domain@s1,s2</code></td>
              <td>多服务器轮询</td>
              <td>cncheck.03k.org@129.211.176.224,112.80.181.45</td>
            </tr>
            <tr>
              <td><code style={{ color: 'var(--accent-cyan)' }}>domain@@IP</code></td>
              <td>直接指定 A/AAAA 记录（子域名匹配）</td>
              <td>www.qq.com@@1.2.3.4</td>
            </tr>
            <tr>
              <td><code style={{ color: 'var(--accent-cyan)' }}>domain@@@IP</code></td>
              <td>直接指定记录（精确匹配）</td>
              <td>www.qq.com@@@1.2.3.4</td>
            </tr>
            <tr>
              <td><code style={{ color: 'var(--accent-cyan)' }}>domain@@CNAME</code></td>
              <td>CNAME 到另一域名（子域名匹配）</td>
              <td>www.qq.com@@qq.03k.org</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="card-title">规则编辑</div>
          <button className="btn btn-secondary btn-sm" onClick={loadFile} disabled={loading}>
            <RefreshCw size={14} /> 刷新
          </button>
        </div>

        <div className="tab-bar" style={{ marginBottom: 16 }}>
          <button
            className={`tab-item ${editMode === 'visual' ? 'active' : ''}`}
            onClick={() => switchEditMode('visual')}
          >
            可视化编辑
          </button>
          <button
            className={`tab-item ${editMode === 'text' ? 'active' : ''}`}
            onClick={() => switchEditMode('text')}
          >
            文本编辑
          </button>
        </div>

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>加载中...</div>
        ) : editMode === 'visual' ? (
          <>
            {entries.map((entry) => (
              <div
                key={entry.id}
                style={{
                  marginBottom: 10,
                  padding: 12,
                  background: 'var(--bg-input)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">域名</label>
                    <input
                      className="form-input"
                      type="text"
                      value={entry.domain}
                      placeholder="cncheck.03k.org"
                      onChange={(e) => updateEntry(entry.id, { domain: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">规则类型</label>
                    <select
                      className="form-select"
                      value={entry.type}
                      onChange={(e) => {
                        const type = e.target.value as TtlRuleEntry['type'];
                        updateEntry(entry.id, { type, matchMode: type === 'forward' ? undefined : entry.matchMode || 'subdomain' });
                      }}
                    >
                      <option value="forward">转发到 DNS 服务器 (@)</option>
                      <option value="record">指定 A/AAAA 记录 (@@/@@@)</option>
                      <option value="cname">CNAME 到域名 (@@)</option>
                    </select>
                  </div>
                </div>
                {entry.type === 'forward' ? (
                  <div className="form-group">
                    <label className="form-label">DNS 服务器</label>
                    <input
                      className="form-input"
                      type="text"
                      value={entry.server}
                      placeholder="129.211.176.224:53 或 129.211.176.224,112.80.181.45"
                      onChange={(e) => updateEntry(entry.id, { server: e.target.value })}
                    />
                    <div className="form-hint">
                      支持 IP:PORT 格式，多服务器用逗号分隔。对应域名 whois 中的 NS 服务器 IP。
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">
                          {entry.type === 'record' ? 'A/AAAA 记录值' : 'CNAME 目标域名'}
                        </label>
                        <input
                          className="form-input"
                          type="text"
                          value={entry.record || ''}
                          placeholder={entry.type === 'record' ? '1.2.3.4 或 2404:6800:4008:c06::99' : 'target.example.com'}
                          onChange={(e) => updateEntry(entry.id, { record: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">匹配方式</label>
                        <select
                          className="form-select"
                          value={entry.matchMode || 'subdomain'}
                          onChange={(e) => updateEntry(entry.id, { matchMode: e.target.value as 'subdomain' | 'exact' })}
                        >
                          <option value="subdomain">子域名匹配 (@@)</option>
                          <option value="exact">精确匹配 (@@@)</option>
                        </select>
                      </div>
                    </div>
                    {entry.type === 'record' && (
                      <div className="form-hint">
                        可指定多条记录，每行一个。支持 IPv4 和 IPv6 地址。
                      </div>
                    )}
                  </>
                )}
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button className="btn btn-danger btn-sm" onClick={() => removeEntry(entry.id)}>
                    <X size={14} /> 删除规则
                  </button>
                </div>
              </div>
            ))}

            <div className="inline-actions">
              <button className="btn btn-secondary btn-sm" onClick={addEntry}>
                <Plus size={14} /> 添加规则
              </button>
            </div>
          </>
        ) : (
          <textarea
            className="textarea-code"
            value={rawContent}
            onChange={(e) => setRawContent(e.target.value)}
            rows={15}
          />
        )}

        <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            <Save size={16} /> {saving ? '保存中...' : '保存到 /data'}
          </button>
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
      </div>

      {ToastComponent}
    </div>
  );
}
