import { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import * as api from '../api';
import { useToast } from '../hooks';
import { ENV_VARS, GROUP_LABELS } from '../types';
import { Copy, Download, Terminal, FileText, AlertTriangle, Plus, X, Edit3 } from 'lucide-react';
import YAML from 'yaml';

type OutputTab = 'docker-run' | 'docker-compose';
type ComposeEditMode = 'preview' | 'edit';

interface PortMapping {
  id: number;
  host: string;
  container: string;
  protocol: 'tcp' | 'udp' | 'tcp+udp';
}

interface ComposeConfig {
  serviceName: string;
  containerName: string;
  image: string;
  restart: string;
  dataPath: string;
  envVars: Record<string, string>;
  ports: PortMapping[];
  network: string;
  cpus: string;
  memory: string;
}

let portIdCounter = 1;

function nextPortId(): number {
  return portIdCounter++;
}

const DEFAULT_PORTS: PortMapping[] = [
  { id: nextPortId(), host: '53', container: '53', protocol: 'udp' },
  { id: nextPortId(), host: '53', container: '53', protocol: 'tcp' },
];

const DEFAULT_ENV_VALUES: Record<string, string> = Object.fromEntries(
  ENV_VARS.map((envVar) => [envVar.key, envVar.defaultValue])
);

const DEFAULT_COMPOSE_CONFIG: ComposeConfig = {
  serviceName: 'paopaodns',
  containerName: 'paopaodns',
  image: 'sliamb/paopaodns:latest',
  restart: 'always',
  dataPath: '/home/mydata',
  envVars: {},
  ports: DEFAULT_PORTS,
  network: '',
  cpus: '',
  memory: '',
};

function slugifyServiceName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'paopaodns';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function generateDockerRun(config: ComposeConfig): string {
  const parts: string[] = ['docker run -d'];
  parts.push(`--name ${shellQuote(config.containerName)}`);
  parts.push(`-v ${shellQuote(`${config.dataPath}:/data`)}`);

  Object.entries(config.envVars).forEach(([k, v]) => {
    parts.push(`-e ${shellQuote(`${k}=${v}`)}`);
  });

  parts.push(`--restart ${shellQuote(config.restart)}`);

  config.ports.forEach((p) => {
    if (p.protocol === 'tcp+udp') {
      parts.push(`-p ${shellQuote(`${p.host}:${p.container}/tcp`)}`);
      parts.push(`-p ${shellQuote(`${p.host}:${p.container}/udp`)}`);
    } else {
      parts.push(`-p ${shellQuote(`${p.host}:${p.container}/${p.protocol}`)}`);
    }
  });

  if (config.network) {
    parts.push(`--network ${shellQuote(config.network)}`);
  }

  if (config.cpus) {
    parts.push(`--cpus ${shellQuote(config.cpus)}`);
  }

  if (config.memory) {
    parts.push(`--memory ${shellQuote(config.memory)}`);
  }

  parts.push(shellQuote(config.image));
  return parts.join(' \\\n  ');
}

function generateDockerCompose(config: ComposeConfig): string {
  const serviceName = slugifyServiceName(config.serviceName);

  const service: Record<string, unknown> = {
    image: config.image,
    container_name: config.containerName,
    restart: config.restart,
    volumes: [
      { type: 'bind', source: config.dataPath, target: '/data' },
    ],
  };

  if (Object.keys(config.envVars).length > 0) {
    service.environment = { ...config.envVars };
  }

  const ports: string[] = [];
  config.ports.forEach((p) => {
    if (p.protocol === 'tcp+udp') {
      ports.push(`${p.host}:${p.container}/tcp`);
      ports.push(`${p.host}:${p.container}/udp`);
    } else {
      ports.push(`${p.host}:${p.container}/${p.protocol}`);
    }
  });
  if (ports.length > 0) {
    service.ports = ports;
  }

  if (config.network) {
    service.networks = [config.network];
  }

  if (config.cpus || config.memory) {
    const limits: Record<string, string> = {};
    if (config.cpus) limits.cpus = config.cpus;
    if (config.memory) limits.memory = config.memory;
    service.deploy = { resources: { limits } };
  }

  const doc: Record<string, unknown> = {
    services: { [serviceName]: service },
  };

  if (config.network) {
    doc.networks = { [config.network]: { external: true } };
  }

  return YAML.stringify(doc);
}

export default function DeployPage() {
  const { envLoaded } = useStore();
  const { showToast, ToastComponent } = useToast();
  const envTouchedRef = useRef(false);
  const [activeTab, setActiveTab] = useState<OutputTab>('docker-compose');
  const [editMode, setEditMode] = useState<ComposeEditMode>('edit');

  const [config, setConfig] = useState<ComposeConfig>(() => ({
    ...DEFAULT_COMPOSE_CONFIG,
    envVars: {},
  }));

  const envLoadedOnInitRef = useRef(false);

  // Sync env values once loaded from API
  useEffect(() => {
    if (!envLoaded || envLoadedOnInitRef.current) return;
    const timer = window.setTimeout(() => {
      envLoadedOnInitRef.current = true;
      api.getEnv().then((env) => {
        if (!envTouchedRef.current) {
          setConfig((prev) => ({ ...prev, envVars: { ...env } }));
        }
      }).catch(() => {
        // Keep the editable values if the optional environment refresh fails.
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [envLoaded]);

  const dockerRunCmd = generateDockerRun(config);
  const dockerComposeContent = generateDockerCompose(config);

  const handleCopy = async (content: string) => {
    await navigator.clipboard.writeText(content);
    showToast('已复制到剪贴板');
  };

  const handleDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast('文件已下载');
  };

  const addPort = () => {
    setConfig((prev) => ({
      ...prev,
      ports: [...prev.ports, { id: nextPortId(), host: '', container: '', protocol: 'tcp' }],
    }));
  };

  const updatePort = (id: number, field: keyof Omit<PortMapping, 'id'>, value: string) => {
    setConfig((prev) => ({
      ...prev,
      ports: prev.ports.map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    }));
  };

  const removePort = (id: number) => {
    setConfig((prev) => ({
      ...prev,
      ports: prev.ports.filter((p) => p.id !== id),
    }));
  };

  const restoreDefaultEnvVars = () => {
    envTouchedRef.current = true;
    setConfig((prev) => ({
      ...prev,
      envVars: { ...DEFAULT_ENV_VALUES },
    }));
  };

  const updateEnvVar = (key: string, value: string) => {
    envTouchedRef.current = true;
    setConfig((prev) => ({
      ...prev,
      envVars: { ...prev.envVars, [key]: value },
    }));
  };

  const removeEnvVar = (key: string) => {
    envTouchedRef.current = true;
    setConfig((prev) => {
      const newEnvVars = { ...prev.envVars };
      delete newEnvVars[key];
      return { ...prev, envVars: newEnvVars };
    });
  };

  return (
    <div className="deploy-page">
      <div className="page-header">
        <h2>部署配置</h2>
        <p>
          可视化编辑 Docker Compose 配置，生成部署文件。不会修改原项目文件，仅用于导出。
        </p>
      </div>

      <div className="stack-actions" style={{ marginBottom: 16 }}>
        <span className="summary-chip">服务 {slugifyServiceName(config.serviceName)}</span>
        <span className="summary-chip">端口 {config.ports.length}</span>
        <span className="summary-chip">环境变量 {Object.keys(config.envVars).length}</span>
        <span className="summary-chip">重启 {config.restart}</span>
      </div>

      <div className="form-panel" style={{ borderColor: 'var(--accent-amber)' }}>
        <div className="card-title">
          <AlertTriangle size={18} style={{ color: 'var(--accent-amber)' }} />
          说明
        </div>
        <div className="card-desc">
          此页面用于生成 <strong>新的部署配置</strong>，不会修改原 PaoPaoDNS 项目的任何文件。<br />
          下方环境变量默认只输出 data/custom_env.ini 中的覆盖值，避免把当前前端维护的默认值固化到新容器。需要完整显式环境变量时可点击“展开全部默认变量”。<br />
          Web UI 无法直接读取当前容器启动时的 Docker 环境变量；这里编辑的是用于新建容器/重新部署导出的配置。
        </div>
      </div>

      <div className="tab-bar">
        <button className={`tab-item ${activeTab === 'docker-compose' ? 'active' : ''}`} onClick={() => setActiveTab('docker-compose')}>
          <FileText size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> docker-compose
        </button>
        <button className={`tab-item ${activeTab === 'docker-run' ? 'active' : ''}`} onClick={() => setActiveTab('docker-run')}>
          <Terminal size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> docker run
        </button>
      </div>

      {activeTab === 'docker-compose' && (
        <div className="tab-bar" style={{ marginTop: 0, borderTop: 'none' }}>
          <button className={`tab-item ${editMode === 'edit' ? 'active' : ''}`} onClick={() => setEditMode('edit')}>
            <Edit3 size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> 编辑配置
          </button>
          <button className={`tab-item ${editMode === 'preview' ? 'active' : ''}`} onClick={() => setEditMode('preview')}>
            <FileText size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> 预览输出
          </button>
        </div>
      )}

      {activeTab === 'docker-compose' && editMode === 'edit' ? (
        <>
          <div className="split-card-grid">
          {/* Basic Settings */}
          <div className="form-panel deploy-basic-panel">
            <div className="card-title">基础配置</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">服务名称 <span className="form-hint" style={{ display: 'inline' }}>(Compose service key)</span></label>
                <input
                  className="form-input"
                  type="text"
                  value={config.serviceName}
                  onChange={(e) => setConfig({ ...config, serviceName: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') })}
                  placeholder="paopaodns"
                />
              </div>
              <div className="form-group">
                <label className="form-label">容器名称 <span className="form-hint" style={{ display: 'inline' }}>(container_name)</span></label>
                <input
                  className="form-input"
                  type="text"
                  value={config.containerName}
                  onChange={(e) => setConfig({ ...config, containerName: e.target.value })}
                  placeholder="paopaodns"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">镜像</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.image}
                  onChange={(e) => setConfig({ ...config, image: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">重启策略</label>
                <select
                  className="form-select"
                  value={config.restart}
                  onChange={(e) => setConfig({ ...config, restart: e.target.value })}
                >
                  <option value="no">no</option>
                  <option value="always">always</option>
                  <option value="on-failure">on-failure</option>
                  <option value="unless-stopped">unless-stopped</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">数据目录路径</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.dataPath}
                  onChange={(e) => setConfig({ ...config, dataPath: e.target.value })}
                  placeholder="/home/mydata"
                />
              </div>
              <div className="form-group">
                <label className="form-label">网络</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.network}
                  onChange={(e) => setConfig({ ...config, network: e.target.value })}
                  placeholder="留空使用默认网络"
                />
              </div>
            </div>
          </div>

          {/* Port Mappings */}
          <div className="form-panel deploy-port-panel">
            <div className="card-title">端口映射</div>
            {config.ports.map((port) => (
              <div key={port.id} className="domain-entry deploy-port-row">
                <input
                  className="form-input"
                  style={{ width: 120, flexShrink: 0 }}
                  type="text"
                  value={port.host}
                  placeholder="宿主机端口"
                  onChange={(e) => updatePort(port.id, 'host', e.target.value)}
                />
                <span style={{ padding: '0 8px', color: 'var(--text-muted)' }}>:</span>
                <input
                  className="form-input"
                  style={{ width: 120, flexShrink: 0 }}
                  type="text"
                  value={port.container}
                  placeholder="容器端口"
                  onChange={(e) => updatePort(port.id, 'container', e.target.value)}
                />
                <select
                  className="form-select"
                  style={{ width: 110, flexShrink: 0 }}
                  value={port.protocol}
                  onChange={(e) => updatePort(port.id, 'protocol', e.target.value as PortMapping['protocol'])}
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                  <option value="tcp+udp">TCP + UDP</option>
                </select>
                <button className="domain-remove-btn" onClick={() => removePort(port.id)}>
                  <X size={16} />
                </button>
              </div>
            ))}
            <div className="inline-actions">
              <button className="btn btn-secondary btn-sm" onClick={addPort}>
                <Plus size={14} /> 添加端口
              </button>
            </div>
          </div>
          </div>

          {/* Environment Variables */}
          <div className="form-panel">
            <div className="card-title">环境变量</div>
            <div className="card-desc">
              这里列出 PaoPaoDNS 常用启动环境变量。未添加的变量生成时不会传递，容器会使用镜像自身默认值；已添加的变量会写入 docker-compose 或 docker run。
            </div>
            <div className="inline-actions">
              <button className="btn btn-secondary btn-sm" onClick={restoreDefaultEnvVars}>
                展开全部默认变量
              </button>
            </div>
            {ENV_VARS.map((envVar, index) => {
              const groupInfo = GROUP_LABELS[envVar.group];
              const previousEnvVar = ENV_VARS[index - 1];
              const showGroupTitle = index === 0 || previousEnvVar.group !== envVar.group;
              const value = config.envVars[envVar.key];
              const isRemoved = value === undefined;

              return (
                <div key={envVar.key}>
                  {showGroupTitle && (
                    <div className="env-compact-group">
                      {groupInfo?.label ?? envVar.group}
                    </div>
                  )}
                  <div className={`env-compact-row ${isRemoved ? 'is-removed' : ''}`}>
                    <div className="env-compact-meta">
                      <code className="env-key-chip">{envVar.key}</code>
                      <span>{envVar.label}</span>
                    </div>
                    <div className="env-compact-control">
                      {envVar.type === 'select' && envVar.options ? (
                        <select
                          className="form-select"
                          value={value ?? envVar.defaultValue}
                          disabled={isRemoved}
                          onChange={(e) => updateEnvVar(envVar.key, e.target.value)}
                        >
                          {envVar.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label} ({option.value})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="form-input"
                          type={envVar.type === 'number' ? 'number' : 'text'}
                          min={envVar.min}
                          max={envVar.max}
                          value={value ?? ''}
                          disabled={isRemoved}
                          placeholder={envVar.placeholder || envVar.defaultValue || '留空'}
                          onChange={(e) => updateEnvVar(envVar.key, e.target.value)}
                        />
                      )}
                    </div>
                    <div className="env-compact-hint" title={`默认值: ${envVar.defaultValue || '空'}。${envVar.description}`}>
                      <span>默认: {envVar.defaultValue || '空'}</span>
                      <span>{isRemoved ? '已移除，生成时不会传递。' : envVar.description}</span>
                    </div>
                    <button
                      className="domain-remove-btn"
                      title={isRemoved ? '恢复默认值' : '不传递此变量'}
                      onClick={() => {
                        if (isRemoved) {
                          updateEnvVar(envVar.key, envVar.defaultValue);
                        } else {
                          removeEnvVar(envVar.key);
                        }
                      }}
                    >
                      {isRemoved ? <Plus size={16} /> : <X size={16} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Advanced Settings */}
          <div className="form-panel">
            <div className="card-title">资源限制</div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">CPU 限制</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.cpus}
                  onChange={(e) => setConfig({ ...config, cpus: e.target.value })}
                  placeholder="例如: 0.5, 1, 2"
                />
              </div>
              <div className="form-group">
                <label className="form-label">内存限制</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.memory}
                  onChange={(e) => setConfig({ ...config, memory: e.target.value })}
                  placeholder="例如: 256M, 1G"
                />
              </div>
            </div>
          </div>
        </>
      ) : null}

          {/* Output Preview */}
      {(activeTab === 'docker-run' || (activeTab === 'docker-compose' && editMode === 'preview')) && (
        <div className="preview-shell command-box">
          <div className="code-header">
            <span>{activeTab === 'docker-run' ? 'docker run 命令' : 'docker-compose.yaml'}</span>
            <div className="btn-group">
              <button
                className="code-copy-btn"
                onClick={() => handleCopy(activeTab === 'docker-run' ? dockerRunCmd : dockerComposeContent)}
              >
                <Copy size={12} /> 复制
              </button>
              <button
                className="code-copy-btn"
                onClick={() =>
                  handleDownload(
                    activeTab === 'docker-run' ? dockerRunCmd : dockerComposeContent,
                    activeTab === 'docker-run' ? 'docker-run.sh' : 'docker-compose.yaml'
                  )
                }
              >
                <Download size={12} /> 下载
              </button>
            </div>
          </div>
          <div className="code-content">
            {activeTab === 'docker-run' ? dockerRunCmd : dockerComposeContent}
          </div>
        </div>
      )}

      {ToastComponent}
    </div>
  );
}
