import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import { ENV_VARS, GROUP_LABELS } from '../types';
import {
  Settings, GitBranch, Globe, ArrowRightLeft,
  Sliders, Bug, AlertTriangle
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { CustomEnvEntry } from '../types';

const ICON_MAP: Record<string, LucideIcon> = {
  Settings, GitBranch, Globe, ArrowRightLeft, Sliders, Bug,
};

const GROUP_ORDER = ['basic', 'cn_routing', 'ipv6', 'custom_forward', 'advanced', 'debug'];

function parseCustomEnv(content: string): CustomEnvEntry[] {
  const entries: CustomEnvEntry[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isCommented = trimmed.startsWith('#');
    const variableLine = isCommented ? trimmed.replace(/^#+\s*/, '') : trimmed;
    const match = variableLine.match(/^([_a-zA-Z0-9]+)="(.*)"$/);
    if (match) {
      entries.push({ key: match[1], value: match[2], enabled: !isCommented });
    }
  }
  return entries;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function EnvConfigPage() {
  const { envValues, customEnvEntries, setCustomEnvEntries, setEnvValues } = useStore();
  const loadEnvRef = useRef<() => Promise<void>>(async () => {});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [runtimeEnvKeys, setRuntimeEnvKeys] = useState<string[]>([]);
  const customEnvByKey = new Map(customEnvEntries.filter((entry) => entry.key).map((entry) => [entry.key, entry]));
  const cnAutoEntry = customEnvByKey.get('CNAUTO');
  const cnAutoEnabled = (cnAutoEntry?.enabled ? cnAutoEntry.value : envValues.CNAUTO) === 'yes';

  const loadEnv = async () => {
    setLoading(true);
    setError('');
    try {
      const status = await api.getStatus();
      setEnvValues(status.env);
      setRuntimeEnvKeys(Object.keys(status.env));

      const result = await api.readFile('custom_env.ini');
      setCustomEnvEntries(parseCustomEnv(result.content || ''));
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      if (message.includes('not found') || message.includes('404')) {
        setCustomEnvEntries([]);
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEnvRef.current = loadEnv;
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadEnvRef.current();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div>
      <div className="page-header">
        <h2>环境变量</h2>
        <p>
          当前生效运行参数（只读）。custom_env.ini 会覆盖 Web 容器中镜像的启动环境变量。
        </p>
      </div>

      <div className="card" style={{ borderColor: 'var(--accent-amber)' }}>
        <div className="card-title">
          <AlertTriangle size={18} style={{ color: 'var(--accent-amber)' }} />
          说明
        </div>
        <div className="card-desc">
          这里显示的是 Web UI 后端能看到的生效变量：先读取 Web UI 容器里镜像的启动环境变量，再由
          <code style={{ color: 'var(--accent-cyan)' }}> custom_env.ini</code> 中已启用的同名变量覆盖。
          <br /><br />
          如需修改变量覆盖，请前往"高级配置"页面编辑 custom_env.ini，修改后会自动热重载，无需重启。
          <br /><br />
          Web UI 不能直接读取另一个 PaoPaoDNS 容器的启动环境变量；需要把对应变量同步到 paopaodns-web 的 environment，修改后重新创建 Web UI 容器。
        </div>
      </div>

      {loading && (
        <div className="card">
          <div className="card-desc">正在读取 custom_env.ini...</div>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderColor: 'var(--accent-red)' }}>
          <div className="card-desc" style={{ color: 'var(--accent-red)' }}>
            读取 custom_env.ini 失败：{error}
          </div>
        </div>
      )}

      {GROUP_ORDER.map((group) => {
        const groupInfo = GROUP_LABELS[group];
        const Icon = ICON_MAP[groupInfo.icon] || Settings;
        const vars = ENV_VARS.filter((v) => v.group === group);
        const hasCnOnly = vars.some((v) => v.requiresCNAUTO);

        return (
          <div className="card" key={group}>
            <div className="card-title">
              <Icon size={18} />
              {groupInfo.label}
              {hasCnOnly && !cnAutoEnabled && (
                <span className="badge badge-amber" style={{ marginLeft: 8 }}>需开启 CNAUTO</span>
              )}
            </div>
            <div className="card-desc">
              {group === 'basic' && '基础运行参数（所有可用变量参考）'}
              {group === 'cn_routing' && 'CN 智能分流配置，需 CNAUTO=yes'}
              {group === 'ipv6' && 'IPv4/IPv6 双栈优化'}
              {group === 'custom_forward' && '自定义 DNS 转发'}
              {group === 'advanced' && '高级功能选项'}
              {group === 'debug' && '调试选项'}
            </div>

            <table className="info-table">
              <thead>
                <tr><th>变量</th><th>当前生效值</th><th>来源</th><th>默认值</th><th>说明</th></tr>
              </thead>
              <tbody>
                {vars.map((v) => {
                  const customEntry = customEnvByKey.get(v.key);
                  const hasDefinedOverride = !!customEntry;
                  const hasActiveOverride = !!customEntry?.enabled;
                  const hasMirroredEnv = runtimeEnvKeys.includes(v.key);
                  const effectiveValue = envValues[v.key] ?? v.defaultValue;
                  const sourceLabel = hasActiveOverride
                    ? 'custom_env.ini'
                    : hasMirroredEnv ? 'Web 容器环境' : '默认值';
                  const sourceBadge = hasActiveOverride
                    ? 'badge-green'
                    : hasMirroredEnv ? 'badge-blue' : 'badge-amber';
                  return (
                    <tr key={v.key} style={{ opacity: (v.requiresCNAUTO && !cnAutoEnabled) ? 0.4 : 1 }}>
                      <td><code style={{ color: 'var(--accent-cyan)' }}>{v.key}</code></td>
                      <td style={{ color: effectiveValue !== v.defaultValue ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: effectiveValue !== v.defaultValue ? 600 : 400 }}>
                        {effectiveValue || <span style={{ color: 'var(--text-muted)' }}>(空)</span>}
                      </td>
                      <td>
                        <span className={`badge ${sourceBadge}`}>{sourceLabel}</span>
                        {hasDefinedOverride && !hasActiveOverride && <span className="badge badge-amber" style={{ marginLeft: 6 }}>custom_env 已禁用</span>}
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{v.defaultValue}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-secondary)', maxWidth: 300 }}>{v.description}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}
