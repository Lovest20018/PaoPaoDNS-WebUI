import { useStore } from '../store';
import { ENV_VARS, GROUP_LABELS } from '../types';
import {
  Settings, GitBranch, Globe, ArrowRightLeft,
  Sliders, Bug, AlertTriangle
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const ICON_MAP: Record<string, LucideIcon> = {
  Settings, GitBranch, Globe, ArrowRightLeft, Sliders, Bug,
};

const GROUP_ORDER = ['basic', 'cn_routing', 'ipv6', 'custom_forward', 'advanced', 'debug'];

export default function EnvConfigPage() {
  const { envValues, customEnvEntries } = useStore();
  const customEnvByKey = new Map(customEnvEntries.filter((entry) => entry.key).map((entry) => [entry.key, entry]));
  const cnAutoEntry = customEnvByKey.get('CNAUTO');
  const cnAutoEnabled = (cnAutoEntry?.enabled ? cnAutoEntry.value : envValues.CNAUTO) === 'yes';

  return (
    <div>
      <div className="page-header">
        <h2>环境变量</h2>
        <p>
          当前 custom_env.ini 中的运行时变量覆盖（只读）。修改环境变量请前往"高级配置"页面编辑 custom_env.ini。
        </p>
      </div>

      <div className="card" style={{ borderColor: 'var(--accent-amber)' }}>
        <div className="card-title">
          <AlertTriangle size={18} style={{ color: 'var(--accent-amber)' }} />
          说明
        </div>
        <div className="card-desc">
          这里显示的是 <code style={{ color: 'var(--accent-cyan)' }}>custom_env.ini</code> 中已定义的运行时变量覆盖。
          本页只按 custom_env.ini 判断“覆盖”；概览页的热重载状态会额外结合 Web 容器中镜像的启动环境变量。
          <br /><br />
          如需修改变量覆盖，请前往"高级配置"页面编辑 custom_env.ini，修改后会自动热重载，无需重启。
          <br /><br />
          如需修改 Docker 启动环境变量（如 CNAUTO、IPV6 等），需要重新创建容器，请使用"部署生成"页面。
        </div>
      </div>

      {GROUP_ORDER.map((group) => {
        const groupInfo = GROUP_LABELS[group];
        const Icon = ICON_MAP[groupInfo.icon] || Settings;
        const vars = ENV_VARS.filter((v) => v.group === group);
        const hasCnOnly = vars.some((v) => v.requiresCNAUTO);

        // Only show non-basic groups when custom_env.ini has related entries.
        const overriddenVars = vars.filter((v) => customEnvByKey.has(v.key));
        if (overriddenVars.length === 0 && group !== 'basic') return null;

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
                <tr><th>变量</th><th>当前覆盖值</th><th>默认值</th><th>说明</th></tr>
              </thead>
              <tbody>
                {vars.map((v) => {
                  const customEntry = customEnvByKey.get(v.key);
                  const hasDefinedOverride = !!customEntry;
                  const hasActiveOverride = !!customEntry?.enabled;
                  return (
                    <tr key={v.key} style={{ opacity: (v.requiresCNAUTO && !cnAutoEnabled) ? 0.4 : 1 }}>
                      <td><code style={{ color: 'var(--accent-cyan)' }}>{v.key}</code></td>
                      <td style={{ color: hasActiveOverride ? 'var(--accent-green)' : 'var(--text-muted)', fontWeight: hasActiveOverride ? 600 : 400 }}>
                        {hasDefinedOverride ? customEntry?.value ?? '' : '未覆盖'}
                        {hasActiveOverride && <span className="badge badge-green" style={{ marginLeft: 6 }}>已覆盖</span>}
                        {hasDefinedOverride && !hasActiveOverride && <span className="badge badge-amber" style={{ marginLeft: 6 }}>已禁用</span>}
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
