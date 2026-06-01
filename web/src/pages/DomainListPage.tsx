import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import { LIST_FILE_INFO } from '../types';
import { Plus, X, FileText, Download, Copy, Save, CheckCircle, AlertCircle, ArrowUp, ArrowDown } from 'lucide-react';
import { useToast } from '../hooks';

const PREFIXES = ['domain', 'full', 'regexp', 'keyword'];

interface DomainEntry {
  id: number;
  prefix: string;
  value: string;
  comment: boolean;
}

function parseListContent(content: string): DomainEntry[] {
  const entries: DomainEntry[] = [];
  let id = 0;
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      const uncommented = trimmed.replace(/^#+\s*/, '');
      const match = uncommented.match(/^(domain|full|regexp|keyword):(.+)$/);
      if (match) {
        entries.push({ id: id++, prefix: match[1], value: match[2], comment: true });
      } else if (uncommented) {
        entries.push({ id: id++, prefix: '__comment__', value: trimmed, comment: true });
      }
      continue;
    }
    const match = trimmed.match(/^(domain|full|regexp|keyword):(.+)$/);
    if (match) {
      entries.push({ id: id++, prefix: match[1], value: match[2], comment: false });
    } else {
      entries.push({ id: id++, prefix: 'domain', value: trimmed, comment: false });
    }
  }
  return entries;
}

function serializeListContent(entries: DomainEntry[]): string {
  const lines: string[] = [];
  for (const e of entries) {
    if (e.prefix === '__comment__') {
      const text = e.value.trimStart();
      lines.push(text.startsWith('#') ? e.value : `# ${e.value}`);
    } else {
      const line = `${e.prefix}:${e.value}`;
      lines.push(e.comment ? `# ${line}` : line);
    }
  }
  return lines.join('\n');
}

const createEntryId = () => Date.now() + Math.random();

const createDomainEntry = (): DomainEntry => ({
  id: createEntryId(),
  prefix: 'domain',
  value: '',
  comment: false,
});

const createCommentEntry = (): DomainEntry => ({
  id: createEntryId(),
  prefix: '__comment__',
  value: '# ',
  comment: true,
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const ALL_LISTS = [
  ...LIST_FILE_INFO,
  {
    key: 'custom_cn_mark',
    filename: 'custom_cn_mark.txt',
    title: '自定义 CN 域名标记',
    description: '额外定义标记为 CN 的域名。当域名被 USE_MARK_DATA 或 IP 库认定为非 CN 但你希望当成 CN 处理时使用。格式同 force_*_list。',
    requiresForward: false,
    defaultContent: `# 自定义 CN 域名标记\n# 当域名被误判为非 CN 时可在此添加\n`,
  },
  {
    key: 'trackerslist',
    filename: 'trackerslist.txt',
    title: 'BT Tracker 列表',
    description: 'BT tracker 域名列表，CN_TRACKER=yes 时这些域名强制走 dnscrypt。每行一个 tracker URL，会自动增量更新合并。',
    requiresForward: false,
    defaultContent: `# BT Tracker 列表\n# 每行一个 tracker URL\n# 自动增量更新合并\n`,
  },
];

export default function DomainListPage() {
  const { setFileContent } = useStore();
  const { showToast, ToastComponent } = useToast();
  const loadRequestId = useRef(0);
  const loadFileRef = useRef<(key: string) => Promise<void>>(async () => {});
  const [activeTab, setActiveTab] = useState('force_dnscrypt_list');
  const [editMode, setEditMode] = useState<'visual' | 'text'>('text');
  const [entries, setEntries] = useState<DomainEntry[]>([]);
  const [rawContent, setRawContent] = useState('');
  const [lastLoadedContent, setLastLoadedContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; msg: string } | null>(null);

  const activeList = ALL_LISTS.find((l) => l.key === activeTab)!;
  const isTrackerList = activeTab === 'trackerslist';
  const ruleCount = entries.filter((entry) => entry.prefix !== '__comment__').length;
  const commentCount = entries.length - ruleCount;
  const disabledRuleCount = entries.filter((entry) => entry.prefix !== '__comment__' && entry.comment).length;
  const getCurrentContent = () => editMode === 'visual' && !isTrackerList ? serializeListContent(entries) : rawContent;
  const hasUnsavedChanges = getCurrentContent() !== lastLoadedContent;

  const loadFile = async (key: string) => {
    const list = ALL_LISTS.find((l) => l.key === key)!;
    const requestId = ++loadRequestId.current;
    setLoading(true);
    try {
      const result = await api.readFile(list.filename);
      const content = result.content || '';
      if (requestId !== loadRequestId.current) return;
      setFileContent(key, content);
      setRawContent(content);
      setEntries(key === 'trackerslist' ? [] : parseListContent(content));
      setLastLoadedContent(content);
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      if (requestId !== loadRequestId.current) return;
      if (message.includes('not found') || message.includes('404')) {
        // File doesn't exist yet — show default content, allow creation
        const content = list.defaultContent;
        setRawContent(content);
        setEntries(key === 'trackerslist' ? [] : parseListContent(content));
        setLastLoadedContent(content);
      } else {
        // Server error — show default but warn user
        const content = list.defaultContent;
        setRawContent(content);
        setEntries(key === 'trackerslist' ? [] : parseListContent(content));
        setLastLoadedContent(content);
        showToast(`读取 ${list.filename} 失败: ${message}`);
      }
    } finally {
      if (requestId === loadRequestId.current) {
        setLoading(false);
      }
    }
  };
  useEffect(() => {
    loadFileRef.current = loadFile;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadFileRef.current(activeTab);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeTab]);

  const switchTab = (key: string) => {
    if (key === activeTab) return;
    if (hasUnsavedChanges && !window.confirm('当前列表有未保存修改，切换后会丢失这些修改。确定继续？')) {
      return;
    }
    setSaveResult(null);
    if (key === 'trackerslist') {
      setEditMode('text');
    }
    setActiveTab(key);
  };

  const switchEditMode = (mode: 'visual' | 'text') => {
    if (mode === editMode) return;
    if (mode === 'visual' && isTrackerList) {
      showToast('trackerslist.txt 是 Tracker URL 列表，仅支持文本编辑，避免改写为 domain: 规则');
      return;
    }
    if (mode === 'visual') {
      setEntries(parseListContent(rawContent));
    } else {
      setRawContent(serializeListContent(entries));
    }
    setEditMode(mode);
  };

  const updateEntry = (id: number, field: keyof DomainEntry, val: string | boolean) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, [field]: val } : e)));
  };

  const addEntry = () => {
    setEntries((prev) => [
      ...prev,
      createDomainEntry(),
    ]);
  };

  const addCommentEntry = () => {
    setEntries((prev) => [
      ...prev,
      createCommentEntry(),
    ]);
  };

  const insertEntryAfter = (id: number, entry: DomainEntry) => {
    setEntries((prev) => {
      const index = prev.findIndex((e) => e.id === id);
      if (index === -1) return [...prev, entry];
      const next = [...prev];
      next.splice(index + 1, 0, entry);
      return next;
    });
  };

  const insertDomainAfter = (id: number) => {
    insertEntryAfter(id, createDomainEntry());
  };

  const insertCommentAfter = (id: number) => {
    insertEntryAfter(id, createCommentEntry());
  };

  const removeEntry = (id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const moveEntry = (id: number, direction: -1 | 1) => {
    setEntries((prev) => {
      const index = prev.findIndex((e) => e.id === id);
      const nextIndex = index + direction;
      if (index === -1 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveResult(null);
    const content = getCurrentContent();
    try {
      const result = await api.writeFile(activeList.filename, content);
      setFileContent(activeTab, content);
      setLastLoadedContent(content);
      let msg: string;
      if (result.watched_now) {
        msg = '已保存，将自动热重载';
      } else if (result.requires_reload) {
        msg = '已保存，需手动 reload';
      } else if (result.requires_restart) {
        msg = '已保存，需重启容器';
      } else if (result.condition) {
        msg = `已保存，但当前不会自动热重载 (${result.condition})`;
      } else {
        msg = '已保存';
      }
      setSaveResult({ success: true, msg });
      showToast('配置已保存到 /data 目录');
    } catch (e: unknown) {
      setSaveResult({ success: false, msg: getErrorMessage(e) || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    const content = getCurrentContent();
    await navigator.clipboard.writeText(content);
    showToast('已复制到剪贴板');
  };

  const handleDownload = () => {
    const content = getCurrentContent();
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = activeList.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="page-header">
        <h2>域名列表管理</h2>
        <p>管理域名分流列表文件。修改保存后，PaoPaoDNS 的 inotifywait 会自动检测变更并热重载。</p>
      </div>

      <div className="card">
        <div className="card-title"><FileText size={18} /> 匹配优先级</div>
        <div className="priority-flow">
          <span className="priority-item" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>custom_mod (top)</span>
          <span className="priority-arrow">&gt;</span>
          <span className="priority-item" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6' }}>force_forward_list</span>
          <span className="priority-arrow">&gt;</span>
          <span className="priority-item" style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>force_dnscrypt_list</span>
          <span className="priority-arrow">&gt;</span>
          <span className="priority-item" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>force_recurse_list</span>
          <span className="priority-arrow">&gt;</span>
          <span className="priority-item" style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4' }}>force_ttl_rules</span>
          <span className="priority-arrow">&gt;</span>
          <span className="priority-item" style={{ background: 'rgba(139,92,246,0.15)', color: '#8b5cf6' }}>custom_mod (list)</span>
          <span className="priority-arrow">&gt;</span>
          <span className="priority-item" style={{ background: 'rgba(107,114,128,0.15)', color: '#6b7280' }}>自动分流</span>
        </div>
      </div>

      <div className="tab-bar">
        {ALL_LISTS.map((list) => (
          <button
            key={list.key}
            className={`tab-item ${activeTab === list.key ? 'active' : ''}`}
            onClick={() => switchTab(list.key)}
          >
            {list.title.replace('强制 ', '').replace('域名列表', '')}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-title">{activeList.title}</div>
        <div className="card-desc">{activeList.description}</div>

        <div className="tab-bar" style={{ marginBottom: 16 }}>
          <button className={`tab-item ${editMode === 'text' ? 'active' : ''}`} onClick={() => switchEditMode('text')}>文本编辑</button>
          <button
            className={`tab-item ${editMode === 'visual' ? 'active' : ''}`}
            onClick={() => switchEditMode('visual')}
            disabled={isTrackerList}
            title={isTrackerList ? 'Tracker URL 列表仅支持文本编辑' : undefined}
          >
            可视化编辑
          </button>
        </div>

        {isTrackerList && (
          <div className="card-desc" style={{ marginBottom: 16, color: 'var(--accent-amber)' }}>
            trackerslist.txt 每行是 Tracker URL，不是 domain/full/regexp 规则。此文件已禁用可视化编辑，避免保存时误加 domain: 前缀。
          </div>
        )}

        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>加载中...</div>
        ) : editMode === 'visual' && !isTrackerList ? (
          <>
            <div className="domain-editor-toolbar">
              <div className="stack-actions">
                <span className="summary-chip">总行 {entries.length}</span>
                <span className="summary-chip">规则 {ruleCount}</span>
                <span className="summary-chip">注释 {commentCount}</span>
                <span className="summary-chip">已禁用 {disabledRuleCount}</span>
              </div>
              <div className="form-hint">每行右侧的“域名 / 注释”会插入到当前行下面；底部按钮用于追加到末尾。</div>
            </div>
            <div className="domain-list-editor">
              {entries.map((entry, index) => (
                <div className={`domain-entry ${entry.prefix === '__comment__' ? 'is-comment' : ''}`} key={entry.id}>
                  <span className="domain-entry-index">{index + 1}</span>
                  <span className={`domain-entry-type ${entry.prefix === '__comment__' ? 'comment' : entry.comment ? 'disabled' : 'rule'}`}>
                    {entry.prefix === '__comment__' ? '注释' : entry.comment ? '禁用' : '规则'}
                  </span>
                  {entry.prefix === '__comment__' ? (
                    <input className="form-input" type="text" value={entry.value} placeholder="# 注释说明" onChange={(e) => updateEntry(entry.id, 'value', e.target.value)} style={{ flex: 1 }} />
                  ) : (
                    <>
                      <select className="form-select domain-prefix-select" value={entry.prefix} onChange={(e) => updateEntry(entry.id, 'prefix', e.target.value)}>
                        {PREFIXES.map((p) => (<option key={p} value={p}>{p}:</option>))}
                      </select>
                      <input className="form-input" type="text" value={entry.value} placeholder="example.com" onChange={(e) => updateEntry(entry.id, 'value', e.target.value)} />
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', cursor: 'pointer' }}>
                        <input type="checkbox" checked={entry.comment} onChange={(e) => updateEntry(entry.id, 'comment', e.target.checked)} />注释
                      </label>
                    </>
                  )}
                  <div className="domain-row-actions">
                    <button className="btn btn-secondary btn-sm" onClick={() => moveEntry(entry.id, -1)} disabled={index === 0} title="上移此行"><ArrowUp size={14} /></button>
                    <button className="btn btn-secondary btn-sm" onClick={() => moveEntry(entry.id, 1)} disabled={index === entries.length - 1} title="下移此行"><ArrowDown size={14} /></button>
                    <button className="btn btn-secondary btn-sm" onClick={() => insertDomainAfter(entry.id)} title="在此行后插入域名"><Plus size={14} /> 域名</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => insertCommentAfter(entry.id)} title="在此行后插入注释"><Plus size={14} /> 注释</button>
                    <button className="domain-remove-btn" onClick={() => removeEntry(entry.id)} title="删除此行"><X size={16} /></button>
                  </div>
                </div>
              ))}
            </div>
            <div className="inline-actions">
              <button className="btn btn-secondary btn-sm" onClick={addEntry}><Plus size={14} /> 添加域名</button>
              <button className="btn btn-secondary btn-sm" onClick={addCommentEntry}><Plus size={14} /> 添加注释</button>
            </div>
          </>
        ) : (
          <textarea className="textarea-code" value={rawContent} onChange={(e) => setRawContent(e.target.value)} rows={15} />
        )}

        <div style={{ marginTop: 16, borderTop: '1px solid var(--border-color)', paddingTop: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={saving} onClick={handleSave}>
            <Save size={16} /> {saving ? '保存中...' : '保存到 /data'}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={handleCopy}><Copy size={14} /> 复制</button>
          <button className="btn btn-secondary btn-sm" onClick={handleDownload}><Download size={14} /> 下载</button>
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

      <div className="card">
        <div className="card-title">域名匹配语法</div>
        <table className="info-table">
          <thead><tr><th>前缀</th><th>说明</th><th>示例</th></tr></thead>
          <tbody>
            <tr><td><code style={{ color: 'var(--accent-cyan)' }}>domain:</code></td><td>匹配域名及子域名</td><td>domain:03k.org</td></tr>
            <tr><td><code style={{ color: 'var(--accent-cyan)' }}>full:</code></td><td>精确匹配，优先级最高</td><td>full:03k.org</td></tr>
            <tr><td><code style={{ color: 'var(--accent-cyan)' }}>regexp:</code></td><td>Go 标准正则</td><td>regexp:.+\.03k\.org$</td></tr>
            <tr><td><code style={{ color: 'var(--accent-cyan)' }}>keyword:</code></td><td>关键字匹配</td><td>keyword:03k.org</td></tr>
          </tbody>
        </table>
      </div>

      {ToastComponent}
    </div>
  );
}
