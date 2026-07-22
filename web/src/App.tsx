import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileCode2,
  FolderOpen,
  KeyRound,
  LoaderCircle,
  Moon,
  RefreshCw,
  Save,
  Sun,
} from 'lucide-react';
import {
  getConfigs,
  getStatus,
  getStoredToken,
  readConfig,
  setToken,
  writeConfig,
  type ConfigInfo,
  type SystemStatus,
} from './api';

const GROUPS = [
  {
    label: '基础参数',
    files: ['custom_env.ini'],
  },
  {
    label: '域名分流',
    files: [
      'force_recurse_list.txt',
      'force_dnscrypt_list.txt',
      'force_forward_list.txt',
      'custom_cn_mark.txt',
    ],
  },
  {
    label: '规则',
    files: ['force_ttl_rules.txt', 'trackerslist.txt'],
  },
  {
    label: '专家配置',
    files: ['custom_mod.yaml', 'unbound_custom.conf'],
  },
] as const;

const FILE_LABELS: Record<string, string> = {
  'custom_env.ini': '运行参数覆盖',
  'force_recurse_list.txt': '强制递归',
  'force_dnscrypt_list.txt': '强制加密解析',
  'force_forward_list.txt': '强制自定义转发',
  'custom_cn_mark.txt': 'CN 域名标记',
  'force_ttl_rules.txt': 'TTL 规则',
  'trackerslist.txt': 'Tracker 列表',
  'custom_mod.yaml': 'MosDNS 自定义模块',
  'unbound_custom.conf': 'Unbound 自定义配置',
};

function effectLabel(info?: ConfigInfo): string {
  if (!info) return '读取生效方式中';
  if (info.requires_restart) return '保存后需重启容器';
  if (info.requires_reload) return '保存后需执行 reload.sh';
  if (info.auto_reload) return info.condition || '保存后由 PaoPaoDNS 自动加载';
  return '请按上游说明应用配置';
}

function App() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [configs, setConfigs] = useState<ConfigInfo[]>([]);
  const [selected, setSelected] = useState('custom_env.ini');
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tokenInput, setTokenInput] = useState(getStoredToken());
  const [needsAuth, setNeedsAuth] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = localStorage.getItem('paopaodns-theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  const dirty = content !== savedContent;
  const currentInfo = useMemo(
    () => configs.find((item) => item.filename === selected),
    [configs, selected],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('paopaodns-theme', theme);
  }, [theme]);

  const loadWorkspace = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextStatus, nextConfigs, file] = await Promise.all([
        getStatus(),
        getConfigs(),
        readConfig(selected),
      ]);
      setStatus(nextStatus);
      setConfigs(nextConfigs);
      setContent(file.content);
      setSavedContent(file.content);
      setNeedsAuth(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : '连接失败';
      setError(message);
      setNeedsAuth(message.includes('Unauthorized'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
    // The selected file is loaded explicitly when switching to avoid reloading status twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const chooseFile = async (filename: string) => {
    if (filename === selected) return;
    if (dirty && !window.confirm('当前文件有未保存的修改，确定切换吗？')) return;
    setSelected(filename);
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const file = await readConfig(filename);
      setContent(file.content);
      setSavedContent(file.content);
    } catch (err) {
      setContent('');
      setSavedContent('');
      setError(err instanceof Error ? err.message : '读取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const reloadCurrent = async () => {
    if (dirty && !window.confirm('确定放弃当前未保存的修改并重新读取吗？')) return;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const file = await readConfig(selected);
      setContent(file.content);
      setSavedContent(file.content);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取配置失败');
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await writeConfig(selected, content);
      setSavedContent(content);
      setNotice(`${FILE_LABELS[selected]}已保存。${effectLabel(result)}`);
      setConfigs((items) => items.map((item) => (
        item.filename === selected ? { ...item, exists: true } : item
      )));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const connect = () => {
    setToken(tokenInput.trim());
    void loadWorkspace();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><FileCode2 size={21} /></div>
          <div>
            <strong>PaoPaoDNS Config</strong>
            <span>轻量配置编辑器</span>
          </div>
        </div>
        <div className="topbar-actions">
          {status && (
            <span className={`connection ${status.data_writable ? 'ok' : 'bad'}`}>
              <CircleDot size={14} />
              {status.data_writable ? '/data 可写' : '/data 只读'}
            </span>
          )}
          <a className="icon-button" href="https://github.com/kkkgo/PaoPaoDNS" target="_blank" rel="noreferrer" title="PaoPaoDNS 上游">
            <ExternalLink size={18} />
          </a>
          <button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="切换主题">
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      </header>

      {loading && !status && !needsAuth ? (
        <main className="auth-wrap">
          <div className="loading"><LoaderCircle className="spin" size={23} />正在连接配置目录</div>
        </main>
      ) : needsAuth ? (
        <main className="auth-wrap">
          <section className="auth-card">
            <div className="auth-icon"><KeyRound size={24} /></div>
            <h1>连接配置目录</h1>
            <p>输入部署 WebUI 时设置的 WEB_UI_TOKEN。Token 只保存在当前浏览器。</p>
            <input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') connect(); }}
              placeholder="WEB_UI_TOKEN"
              autoFocus
            />
            <button className="primary-button" onClick={connect}>连接</button>
            {error && <div className="message error"><AlertCircle size={16} />{error}</div>}
          </section>
        </main>
      ) : (
        <main className="workspace">
          <aside className="file-sidebar">
            <div className="sidebar-title"><FolderOpen size={17} />配置文件</div>
            {GROUPS.map((group) => (
              <section className="file-group" key={group.label}>
                <h2>{group.label}</h2>
                {group.files.map((filename) => {
                  const info = configs.find((item) => item.filename === filename);
                  return (
                    <button
                      key={filename}
                      className={`file-item ${selected === filename ? 'active' : ''}`}
                      onClick={() => void chooseFile(filename)}
                    >
                      <span className={`file-dot ${info?.exists ? 'exists' : ''}`} />
                      <span>
                        <strong>{FILE_LABELS[filename]}</strong>
                        <small>{filename}</small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  );
                })}
              </section>
            ))}
          </aside>

          <section className="editor-panel">
            <div className="editor-header">
              <div>
                <div className="eyebrow">{selected}</div>
                <h1>{FILE_LABELS[selected]}</h1>
                <p>{effectLabel(currentInfo)}</p>
              </div>
              <div className="editor-actions">
                <button className="secondary-button" onClick={() => void reloadCurrent()} disabled={loading || saving}>
                  <RefreshCw size={16} />重新读取
                </button>
                <button className="primary-button" onClick={() => void save()} disabled={!dirty || loading || saving || !status?.data_writable}>
                  {saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}
                  {saving ? '保存中' : '保存'}
                </button>
              </div>
            </div>

            <div className={`effect-note ${currentInfo?.requires_restart ? 'warn' : ''}`}>
              <Check size={16} />
              保存前会校验格式，并将旧内容备份为 <code>{selected}.bak</code>。
            </div>

            {error && <div className="message error"><AlertCircle size={16} />{error}</div>}
            {notice && <div className="message success"><Check size={16} />{notice}</div>}

            <div className="editor-wrap">
              {loading ? (
                <div className="loading"><LoaderCircle className="spin" size={23} />正在读取配置</div>
              ) : (
                <textarea
                  aria-label={`${selected} 内容`}
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                  disabled={!status?.data_writable}
                />
              )}
            </div>
            <footer className="editor-footer">
              <span>{content.split('\n').length} 行 · {new Blob([content]).size} 字节</span>
              <span className={dirty ? 'dirty' : ''}>{dirty ? '有未保存修改' : '已与磁盘同步'}</span>
            </footer>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
