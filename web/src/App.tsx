import { useEffect, useState } from 'react';
import {
  LayoutDashboard, FileText, Terminal,
  Clock, SlidersHorizontal, ExternalLink, Moon, Sun
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import OverviewPage from './pages/OverviewPage';
import DomainListPage from './pages/DomainListPage';
import EnvConfigPage from './pages/EnvConfigPage';
import DeployPage from './pages/DeployPage';
import TtlRulesPage from './pages/TtlRulesPage';
import AdvancedConfigPage from './pages/AdvancedConfigPage';

type Page = 'overview' | 'env' | 'lists' | 'deploy' | 'ttl' | 'advanced';
type ThemeMode = 'light' | 'dark';

const NAV_ITEMS: { key: Page; label: string; icon: LucideIcon }[] = [
  { key: 'overview', label: '概览', icon: LayoutDashboard },
  { key: 'env', label: '环境变量', icon: SlidersHorizontal },
  { key: 'lists', label: '域名列表', icon: FileText },
  { key: 'deploy', label: '部署生成', icon: Terminal },
  { key: 'ttl', label: 'TTL 规则', icon: Clock },
  { key: 'advanced', label: '高级配置', icon: SlidersHorizontal },
];

const PAGE_PATHS: Record<Page, string> = {
  overview: '/',
  env: '/env',
  lists: '/lists',
  deploy: '/deploy',
  ttl: '/ttl',
  advanced: '/advanced',
};

const PATH_PAGES = new Map<string, Page>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as Page]),
);

const PAGE_COMPONENTS: Record<Page, React.FC> = {
  overview: OverviewPage,
  env: EnvConfigPage,
  lists: DomainListPage,
  deploy: DeployPage,
  ttl: TtlRulesPage,
  advanced: AdvancedConfigPage,
};

const WEB_UI_REPO_URL = 'https://github.com/Lovest20018/PaoPaoDNS-WebUI';
const UPSTREAM_REPO_URL = 'https://github.com/kkkgo/PaoPaoDNS';

function pageFromHash(): Page {
  const hashPath = window.location.hash.replace(/^#/, '') || '/';
  return PATH_PAGES.get(hashPath) ?? 'overview';
}

function App() {
  const [activePage, setActivePage] = useState<Page>(() => pageFromHash());
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    const savedTheme = localStorage.getItem('paopaodns-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  });
  const ActiveComponent = PAGE_COMPONENTS[activePage];
  const activeNavItem = NAV_ITEMS.find((item) => item.key === activePage);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem('paopaodns-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    const syncRoute = () => setActivePage(pageFromHash());
    window.addEventListener('hashchange', syncRoute);
    if (!window.location.hash) {
      window.history.replaceState(null, '', '#/');
    }
    syncRoute();
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  const toggleTheme = () => {
    setThemeMode((current) => (current === 'dark' ? 'light' : 'dark'));
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">P</div>
          <div>
            <h1>PaoPaoDNS</h1>
            <p>DNS 配置管理面板</p>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section-title">导航</div>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.key}
                href={`#${PAGE_PATHS[item.key]}`}
                className={`nav-item ${activePage === item.key ? 'active' : ''}`}
                aria-current={activePage === item.key ? 'page' : undefined}
              >
                <Icon aria-hidden="true" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <a
            href={WEB_UI_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            <ExternalLink size={14} />
            PaoPaoDNS-WebUI
          </a>
          <a
            href={UPSTREAM_REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)', textDecoration: 'none', marginTop: 8 }}
          >
            <ExternalLink size={14} />
            PaoPaoDNS 上游
          </a>
        </div>
      </aside>

      <main className="main-content">
        <header className="mobile-header">
          <div className="mobile-header-title">
            <div className="brand-mark">P</div>
            <h1>PaoPaoDNS</h1>
          </div>
        </header>

        <div className="main-toolbar">
          <div>
            <span className="eyebrow">Control Center</span>
            <h1>{activeNavItem?.label}</h1>
          </div>
          <div className="toolbar-actions">
            <button
              className="theme-toggle"
              type="button"
              onClick={toggleTheme}
              title={themeMode === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
              aria-label={themeMode === 'dark' ? '切换到日间模式' : '切换到夜间模式'}
            >
              {themeMode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
              <span>{themeMode === 'dark' ? '日间' : '夜间'}</span>
            </button>
            <div className="status-pill" aria-label="本地配置模式">
              <span className="status-dot" aria-hidden="true" />
              本地配置模式
            </div>
          </div>
        </div>
        <section className="content-shell">
          <ActiveComponent />
        </section>
      </main>
    </div>
  );
}

export default App;
