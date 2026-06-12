import { useState, useEffect, useRef } from 'react';
import * as api from '../api';
import { useToast } from '../hooks';
import { ENV_VARS, GROUP_LABELS } from '../types';
import { Copy, Download, Terminal, FileText, AlertTriangle, Plus, X, Edit3 } from 'lucide-react';
import YAML from 'yaml';

type OutputTab = 'docker-run' | 'docker-compose';
type ComposeEditMode = 'preview' | 'edit';
type DeploymentMode = 'full' | 'sidecar';
type DataMountType = 'bind' | 'volume';

interface PortMapping {
  id: number;
  host: string;
  container: string;
  protocol: 'tcp' | 'udp' | 'tcp+udp';
}

interface ComposeConfig {
  deploymentMode: DeploymentMode;
  serviceName: string;
  containerName: string;
  image: string;
  restart: string;
  dataMountType: DataMountType;
  dataPath: string;
  envVars: Record<string, string>;
  ports: PortMapping[];
  network: string;
  cpus: string;
  memory: string;
  webUi: WebUiConfig;
}

interface WebUiConfig {
  enabled: boolean;
  serviceName: string;
  containerName: string;
  image: string;
  restart: string;
  host: string;
  hostPort: string;
  dnsTestServer: string;
  token: string;
  mirrorRuntimeEnv: boolean;
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
  deploymentMode: 'full',
  serviceName: 'paopaodns',
  containerName: 'paopaodns',
  image: 'sliamb/paopaodns:latest',
  restart: 'always',
  dataMountType: 'bind',
  dataPath: '/home/mydata',
  envVars: {},
  ports: DEFAULT_PORTS,
  network: '',
  cpus: '',
  memory: '',
  webUi: {
    enabled: true,
    serviceName: 'paopaodns-web',
    containerName: 'paopaodns-web',
    image: 'ghcr.io/lovest20018/paopaodns-webui:latest',
    restart: 'always',
    host: '',
    hostPort: '8080',
    dnsTestServer: '',
    token: '${WEB_UI_TOKEN:?set WEB_UI_TOKEN}',
    mirrorRuntimeEnv: true,
  },
};

const WEB_UI_MIRRORED_ENV_KEYS = ENV_VARS.map((envVar) => envVar.key);
const DOCKER_RUN_SEPARATOR = ' \\' + '\n  ';
const DEFAULT_BIND_DATA_PATH = '/home/mydata';
const DEFAULT_VOLUME_NAME = 'paopaodns-data';
const DEFAULT_YAML_ANCHOR = 'a1';
const DATA_VOLUME_YAML_ANCHOR = 'paopao_data';

function slugifyServiceName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'paopaodns';
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isShellParameterExpansion(value: string): boolean {
  return /^\$\{[A-Za-z_][A-Za-z0-9_]*(?::[?+\-=][^}]*)?\}$/.test(value);
}

function dockerEnvFlag(key: string, value: string): string {
  if (isShellParameterExpansion(value)) {
    return `-e ${key}=${value}`;
  }
  return `-e ${shellQuote(`${key}=${value}`)}`;
}

function normalizeVolumeName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith('/') || trimmed.includes('\\') || trimmed.includes(':')) {
    return DEFAULT_VOLUME_NAME;
  }
  return trimmed.replace(/[^a-zA-Z0-9_.-]/g, '-') || DEFAULT_VOLUME_NAME;
}

function dataSource(config: ComposeConfig): string {
  return config.dataMountType === 'volume' ? normalizeVolumeName(config.dataPath) : config.dataPath;
}

function dataVolumeSpec(config: ComposeConfig): string {
  return `${dataSource(config)}:/data`;
}

function webUiPortMapping(config: ComposeConfig): string {
  const hostPrefix = config.webUi.host.trim() ? `${config.webUi.host.trim()}:` : '';
  return `${hostPrefix}${config.webUi.hostPort || '8080'}:8080`;
}

function webUiDnsTestServer(config: ComposeConfig): string {
  const customServer = config.webUi.dnsTestServer.trim();
  if (customServer) return customServer;
  return config.deploymentMode === 'full' ? slugifyServiceName(config.serviceName) : 'paopaodns';
}

function dockerRunNetwork(config: ComposeConfig): string {
  const customNetwork = config.network.trim();
  if (customNetwork) return customNetwork;
  return config.deploymentMode === 'full' ? `${slugifyServiceName(config.serviceName)}-net` : '';
}

function buildWebUiEnvironment(config: ComposeConfig): Record<string, string> {
  const environment: Record<string, string> = {
    DATA_DIR: '/data',
    DNS_TEST_SERVER: webUiDnsTestServer(config),
    WEB_UI_TOKEN: config.webUi.token,
  };

  if (config.webUi.mirrorRuntimeEnv) {
    WEB_UI_MIRRORED_ENV_KEYS.forEach((key) => {
      if (config.envVars[key] !== undefined) {
        environment[key] = config.envVars[key];
      }
    });
  }

  return environment;
}

function renameDataVolumeYamlAnchor(yaml: string): string {
  // yaml names the first shared object a1; make the generated compose easier to read.
  return yaml
    .replace(new RegExp(`&${DEFAULT_YAML_ANCHOR}\\b`, 'g'), `&${DATA_VOLUME_YAML_ANCHOR}`)
    .replace(new RegExp(`\\*${DEFAULT_YAML_ANCHOR}\\b`, 'g'), `*${DATA_VOLUME_YAML_ANCHOR}`);
}

function generateMainDockerRun(config: ComposeConfig): string {
  const parts: string[] = ['docker run -d'];
  const network = dockerRunNetwork(config);
  parts.push(`--name ${shellQuote(config.containerName)}`);
  parts.push(`-v ${shellQuote(dataVolumeSpec(config))}`);

  Object.entries(config.envVars).forEach(([k, v]) => {
    parts.push(dockerEnvFlag(k, v));
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

  if (network) {
    parts.push(`--network ${shellQuote(network)}`);
    parts.push(`--network-alias ${shellQuote(slugifyServiceName(config.serviceName))}`);
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

function generateWebUiDockerRun(config: ComposeConfig): string {
  const parts: string[] = ['docker run -d'];
  const network = dockerRunNetwork(config);
  parts.push(`--name ${shellQuote(config.webUi.containerName)}`);
  parts.push(`-v ${shellQuote(dataVolumeSpec(config))}`);
  Object.entries(buildWebUiEnvironment(config)).forEach(([k, v]) => {
    parts.push(dockerEnvFlag(k, v));
  });
  parts.push(`--restart ${shellQuote(config.webUi.restart)}`);
  parts.push(`-p ${shellQuote(webUiPortMapping(config))}`);
  if (network) {
    parts.push(`--network ${shellQuote(network)}`);
  }
  parts.push(shellQuote(config.webUi.image));
  return parts.join(DOCKER_RUN_SEPARATOR);
}

function generateDockerRun(config: ComposeConfig): string {
  const commands: string[] = [];
  if (config.deploymentMode === 'full') {
    if (!config.network.trim()) {
      const network = dockerRunNetwork(config);
      commands.push(
        '# 创建专用网络，确保两个容器可以通过服务名互相解析',
        `docker network inspect ${shellQuote(network)} >/dev/null 2>&1 || docker network create ${shellQuote(network)}`
      );
    }
    commands.push('# PaoPaoDNS 主容器', generateMainDockerRun(config));
    if (config.webUi.enabled) {
      commands.push('# Web UI sidecar', generateWebUiDockerRun(config));
    }
  } else {
    commands.push('# Web UI sidecar，接入已有 PaoPaoDNS /data', generateWebUiDockerRun(config));
  }
  return commands.join('\n\n');
}

function generateDockerCompose(config: ComposeConfig): string {
  const serviceName = slugifyServiceName(config.serviceName);
  const requestedWebServiceName = slugifyServiceName(config.webUi.serviceName);
  const webServiceName = config.deploymentMode === 'full' && requestedWebServiceName === serviceName
    ? `${requestedWebServiceName}-web`
    : requestedWebServiceName;
  const serviceVolume = config.dataMountType === 'volume'
    ? { type: 'volume', source: dataSource(config), target: '/data' }
    : { type: 'bind', source: dataSource(config), target: '/data' };

  const service: Record<string, unknown> = {
    image: config.image,
    container_name: config.containerName,
    restart: config.restart,
    volumes: [serviceVolume],
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

  const services: Record<string, unknown> = {};
  if (config.deploymentMode === 'full') {
    services[serviceName] = service;
  }

  if (config.deploymentMode === 'sidecar' || config.webUi.enabled) {
    const webService: Record<string, unknown> = {
      image: config.webUi.image,
      container_name: config.webUi.containerName,
      restart: config.webUi.restart,
      volumes: [serviceVolume],
      environment: buildWebUiEnvironment(config),
      ports: [webUiPortMapping(config)],
    };
    if (config.network) {
      webService.networks = [config.network];
    }
    if (config.deploymentMode === 'full') {
      webService.depends_on = [serviceName];
    }
    services[webServiceName] = webService;
  }

  const doc: Record<string, unknown> = { services };

  if (config.network) {
    doc.networks = { [config.network]: { external: true } };
  }

  if (config.dataMountType === 'volume') {
    doc.volumes = { [dataSource(config)]: {} };
  }

  return renameDataVolumeYamlAnchor(YAML.stringify(doc));
}

export default function DeployPage() {
  const { showToast, ToastComponent } = useToast();
  const envTouchedRef = useRef(false);
  const [activeTab, setActiveTab] = useState<OutputTab>('docker-compose');
  const [editMode, setEditMode] = useState<ComposeEditMode>('edit');

  const [config, setConfig] = useState<ComposeConfig>(() => ({
    ...DEFAULT_COMPOSE_CONFIG,
    envVars: {},
  }));

  const envLoadedOnInitRef = useRef(false);

  // Import the runtime env that the Web UI backend can see. This lets the
  // generated compose mirror PaoPaoDNS values into the Web UI sidecar.
  useEffect(() => {
    if (envLoadedOnInitRef.current) return;
    const timer = window.setTimeout(() => {
      envLoadedOnInitRef.current = true;
      api.getStatus().then((status) => {
        if (!envTouchedRef.current) {
          setConfig((prev) => ({ ...prev, envVars: { ...status.env } }));
        }
      }).catch(() => {
        api.getEnv().then((env) => {
          if (!envTouchedRef.current) {
            setConfig((prev) => ({ ...prev, envVars: { ...env } }));
          }
        }).catch(() => {
          showToast('读取环境变量失败，生成的配置将不包含环境变量，可点击"展开全部默认变量"手动添加');
        });
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [showToast]);

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

  const importRuntimeEnvVars = async () => {
    envTouchedRef.current = true;
    try {
      const status = await api.getStatus();
      setConfig((prev) => ({ ...prev, envVars: { ...status.env } }));
      showToast('已导入 Web UI 当前可见的生效环境变量');
    } catch {
      try {
        const env = await api.getEnv();
        setConfig((prev) => ({ ...prev, envVars: { ...env } }));
        showToast('已导入 custom_env.ini 中的环境变量覆盖');
      } catch {
        showToast('读取环境变量失败，可点击"展开全部默认变量"手动添加');
      }
    }
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

  const updateWebUi = <K extends keyof WebUiConfig>(field: K, value: WebUiConfig[K]) => {
    setConfig((prev) => ({
      ...prev,
      webUi: { ...prev.webUi, [field]: value },
    }));
  };

  const updateDeploymentMode = (deploymentMode: DeploymentMode) => {
    setConfig((prev) => ({
      ...prev,
      deploymentMode,
      webUi: { ...prev.webUi, enabled: deploymentMode === 'sidecar' ? true : prev.webUi.enabled },
    }));
  };

  const updateDataMountType = (dataMountType: DataMountType) => {
    setConfig((prev) => ({
      ...prev,
      dataMountType,
      dataPath: dataMountType === 'volume'
        ? normalizeVolumeName(prev.dataPath)
        : prev.dataPath === DEFAULT_VOLUME_NAME ? DEFAULT_BIND_DATA_PATH : prev.dataPath,
    }));
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
        <span className="summary-chip">模式 {config.deploymentMode === 'full' ? '新建完整部署' : '仅 WebUI sidecar'}</span>
        {config.deploymentMode === 'full' && <span className="summary-chip">主服务 {slugifyServiceName(config.serviceName)}</span>}
        {(config.deploymentMode === 'sidecar' || config.webUi.enabled) && <span className="summary-chip">WebUI {slugifyServiceName(config.webUi.serviceName)}</span>}
        <span className="summary-chip">端口 {config.ports.length}</span>
        <span className="summary-chip">环境变量 {Object.keys(config.envVars).length}</span>
        <span className="summary-chip">数据 {config.dataMountType === 'volume' ? 'volume' : 'bind'}</span>
      </div>

      <div className="form-panel" style={{ borderColor: 'var(--accent-amber)' }}>
        <div className="card-title">
          <AlertTriangle size={18} style={{ color: 'var(--accent-amber)' }} />
          说明
        </div>
        <div className="card-desc">
          此页面用于生成 <strong>新的部署配置</strong>，不会修改原 PaoPaoDNS 项目的任何文件。<br />
          可生成 PaoPaoDNS + Web UI 的完整部署，也可以只生成 Web UI sidecar 接入已有 PaoPaoDNS。<br />
          下方环境变量会自动导入 Web UI 后端当前可见的生效变量，并在生成时同步给 Web UI sidecar；需要完整显式环境变量时可点击“展开全部默认变量”。<br />
          Web UI 不能直接读取另一个 PaoPaoDNS 容器的启动环境变量；推荐先把 PaoPaoDNS 变量同步到 paopaodns-web 的 environment，再用这里导出新的 compose。
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
          <div className="form-panel">
            <div className="card-title">部署模式和共享数据</div>
            <div className="card-desc">
              完整部署会同时生成 PaoPaoDNS 主容器和 Web UI sidecar；sidecar 模式只生成 Web UI，用来接入已有 PaoPaoDNS 的 /data。
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">部署模式</label>
                <select
                  className="form-select"
                  value={config.deploymentMode}
                  onChange={(e) => updateDeploymentMode(e.target.value as DeploymentMode)}
                >
                  <option value="full">新建 PaoPaoDNS + Web UI</option>
                  <option value="sidecar">仅 Web UI sidecar，接入已有 PaoPaoDNS</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">/data 挂载类型</label>
                <select
                  className="form-select"
                  value={config.dataMountType}
                  onChange={(e) => updateDataMountType(e.target.value as DataMountType)}
                >
                  <option value="bind">宿主机目录 bind mount</option>
                  <option value="volume">Docker named volume</option>
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">{config.dataMountType === 'volume' ? 'Volume 名称' : '宿主机数据目录'}</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.dataPath}
                  onChange={(e) => setConfig({ ...config, dataPath: e.target.value })}
                  placeholder={config.dataMountType === 'volume' ? 'paopaodns-data' : '/home/mydata'}
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

          {config.deploymentMode === 'full' && (
          <div className="split-card-grid">
          {/* Basic Settings */}
          <div className="form-panel deploy-basic-panel">
            <div className="card-title">PaoPaoDNS 主容器</div>
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
              <div className="form-hint">主容器和 Web UI 会共用上方配置的 /data 挂载。</div>
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
          )}

          <div className="form-panel">
            <div className="card-title">Web UI sidecar</div>
            <div className="card-desc">
              Web UI 只读写共享 /data，不挂载 Docker socket。监听地址留空会绑定所有地址，便于局域网访问；公网建议配合反向代理和 HTTPS。
            </div>
            {config.deploymentMode === 'full' && (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={config.webUi.enabled}
                  onChange={(e) => updateWebUi('enabled', e.target.checked)}
                />
                <span>在完整部署中包含 Web UI 管理面板</span>
              </label>
            )}
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">服务名称</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.webUi.serviceName}
                  onChange={(e) => updateWebUi('serviceName', e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                  placeholder="paopaodns-web"
                />
              </div>
              <div className="form-group">
                <label className="form-label">容器名称</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.webUi.containerName}
                  onChange={(e) => updateWebUi('containerName', e.target.value)}
                  placeholder="paopaodns-web"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Web UI 镜像</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.webUi.image}
                  onChange={(e) => updateWebUi('image', e.target.value)}
                />
              </div>
              <div className="form-group">
                <label className="form-label">重启策略</label>
                <select
                  className="form-select"
                  value={config.webUi.restart}
                  onChange={(e) => updateWebUi('restart', e.target.value)}
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
                <label className="form-label">监听地址</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.webUi.host}
                  onChange={(e) => updateWebUi('host', e.target.value)}
                  placeholder="127.0.0.1，留空则绑定所有地址"
                />
              </div>
              <div className="form-group">
                <label className="form-label">DNS 诊断目标</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.webUi.dnsTestServer}
                  onChange={(e) => updateWebUi('dnsTestServer', e.target.value)}
                  placeholder={config.deploymentMode === 'full' ? `${slugifyServiceName(config.serviceName)} (自动)` : 'paopaodns'}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">宿主机端口</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.webUi.hostPort}
                  onChange={(e) => updateWebUi('hostPort', e.target.value)}
                  placeholder="8080"
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">WEB_UI_TOKEN</label>
                <input
                  className="form-input"
                  type="text"
                  value={config.webUi.token}
                  onChange={(e) => updateWebUi('token', e.target.value)}
                  placeholder="${WEB_UI_TOKEN:?set WEB_UI_TOKEN}"
                />
              </div>
              <label className="checkbox-row deploy-checkbox-row">
                <input
                  type="checkbox"
                  checked={config.webUi.mirrorRuntimeEnv}
                  onChange={(e) => updateWebUi('mirrorRuntimeEnv', e.target.checked)}
                />
                <span>同步关键 PaoPaoDNS 环境变量，用于 Web UI 判断热重载条件</span>
              </label>
            </div>
          </div>

          {/* Environment Variables */}
          <div className="form-panel">
            <div className="card-title">环境变量</div>
            <div className="card-desc">
              这里列出 PaoPaoDNS 常用启动环境变量。已添加的变量会同时写入 PaoPaoDNS 主容器，并镜像给 Web UI sidecar 用于显示当前生效配置和判断热重载条件。
            </div>
            <div className="inline-actions">
              <button className="btn btn-secondary btn-sm" onClick={importRuntimeEnvVars}>
                导入当前生效变量
              </button>
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
