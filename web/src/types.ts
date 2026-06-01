export interface EnvVar {
  key: string;
  label: string;
  description: string;
  defaultValue: string;
  type: 'select' | 'text' | 'number' | 'ip_port';
  options?: { value: string; label: string }[];
  requiresCNAUTO?: boolean;
  group: 'basic' | 'cn_routing' | 'ipv6' | 'advanced' | 'custom_forward' | 'debug';
  placeholder?: string;
  min?: number;
  max?: number;
}

export const ENV_VARS: EnvVar[] = [
  // basic
  {
    key: 'CNAUTO',
    label: 'CN 智能分流',
    description: '是否开启大陆智能分流，位于境外可配置为 no。关闭后除递归以外的功能将不会工作。',
    defaultValue: 'yes',
    type: 'select',
    options: [
      { value: 'yes', label: '开启' },
      { value: 'no', label: '关闭' },
    ],
    group: 'basic',
  },
  {
    key: 'DNSPORT',
    label: 'DNS 端口',
    description: '设置 DNS 服务器端口，仅在 CNAUTO=no 时生效。',
    defaultValue: '53',
    type: 'number',
    min: 1,
    max: 65535,
    group: 'basic',
  },
  {
    key: 'DNS_SERVERNAME',
    label: '服务器名称',
    description: 'DNS 服务器名称，Windows nslookup 时会显示。不含空格的英文字符串。',
    defaultValue: 'PaoPaoDNS,blog.03k.org',
    type: 'text',
    group: 'basic',
  },
  {
    key: 'TZ',
    label: '时区',
    description: '系统运行时区，仅影响日志输出，不影响程序运行。',
    defaultValue: 'Asia/Shanghai',
    type: 'text',
    placeholder: 'Asia/Shanghai',
    group: 'basic',
  },
  {
    key: 'UPDATE',
    label: '数据更新频率',
    description: '检查更新根域数据和 GEOIP 数据的频率。daily=每天凌晨2点，weekly=每周6凌晨3点，monthly=每月1号凌晨5点。',
    defaultValue: 'weekly',
    type: 'select',
    options: [
      { value: 'no', label: '不更新' },
      { value: 'daily', label: '每天' },
      { value: 'weekly', label: '每周' },
      { value: 'monthly', label: '每月' },
    ],
    group: 'basic',
  },
  {
    key: 'SERVER_IP',
    label: '服务器外部 IP',
    description: '指定 DNS 服务器的外部 IP。当容器通过端口映射而非独立 IP 运行时，设置此项可显示正确的服务器名称，并设定 paopao.dns 指向该 IP。',
    defaultValue: '',
    type: 'text',
    placeholder: '10.10.10.8',
    group: 'basic',
  },
  // cn_routing
  {
    key: 'SOCKS5',
    label: 'SOCKS5 代理',
    description: '为分流非 CN 域名优先使用 SOCKS5 查询。加 @ 前缀强制走 socks5，如 @10.10.10.8:7890。初始化约需3分钟延迟测试。',
    defaultValue: '',
    type: 'text',
    placeholder: '10.10.10.8:7890 或 @10.10.10.8:7890',
    requiresCNAUTO: true,
    group: 'cn_routing',
  },
  {
    key: 'CNFALL',
    label: '递归回退转发',
    description: '递归查询网络质量差时是否回退到转发查询。yes=兼顾质量和网络，no=保证实时准确但要求网络稳定。推荐公网IP一级路由下设为 no。',
    defaultValue: 'yes',
    type: 'select',
    options: [
      { value: 'yes', label: '开启回退' },
      { value: 'no', label: '仅递归' },
    ],
    requiresCNAUTO: true,
    group: 'cn_routing',
  },
  {
    key: 'EXPIRED_FLUSH',
    label: '过期缓存清理',
    description: '监测乐观缓存，递归失败后主动回收清除过期记录，提高解析实时性。需 CNAUTO 和 CNFALL 均为 yes。',
    defaultValue: 'yes',
    type: 'select',
    options: [
      { value: 'yes', label: '开启' },
      { value: 'no', label: '关闭' },
    ],
    requiresCNAUTO: true,
    group: 'cn_routing',
  },
  {
    key: 'USE_MARK_DATA',
    label: '全球域名标记库',
    description: '自动下载预先标记的全球百万域名库，优化 DNS 泄漏问题，提供更快速精准的分流，但占用更多内存。',
    defaultValue: 'yes',
    type: 'select',
    options: [
      { value: 'yes', label: '开启' },
      { value: 'no', label: '关闭' },
    ],
    requiresCNAUTO: true,
    group: 'cn_routing',
  },
  {
    key: 'CN_TRACKER',
    label: 'BT Tracker 强制加密',
    description: '强制 tracker 域名走 dnscrypt 解析，可避免 fakeip 连接 tracker。自动下载最新 tracker 列表。',
    defaultValue: 'yes',
    type: 'select',
    options: [
      { value: 'yes', label: '开启' },
      { value: 'no', label: '关闭' },
    ],
    requiresCNAUTO: true,
    group: 'cn_routing',
  },
  // ipv6
  {
    key: 'IPV6',
    label: 'IPv6 模式',
    description: 'no=不返回IPv6；yes=返回IPv6(非大陆双栈仅A记录)；only6=仅IPv6 only域名返回；yes_only6=大陆yes+非大陆only6；raw=不做处理。',
    defaultValue: 'no',
    type: 'select',
    options: [
      { value: 'no', label: '关闭 IPv6' },
      { value: 'yes', label: '开启 IPv6' },
      { value: 'only6', label: '仅 IPv6 Only' },
      { value: 'yes_only6', label: '大陆 Yes + 非 CN Only6' },
      { value: 'raw', label: '原始记录（不做处理）' },
    ],
    requiresCNAUTO: true,
    group: 'ipv6',
  },
  // custom_forward
  {
    key: 'CUSTOM_FORWARD',
    label: '自定义转发 DNS',
    description: '将 force_forward_list.txt 内的域名转发到指定 DNS 服务器。可配合第三方旁网关 fakeip、域名嗅探等特性。',
    defaultValue: '',
    type: 'ip_port',
    placeholder: '10.10.10.3:53',
    requiresCNAUTO: true,
    group: 'custom_forward',
  },
  {
    key: 'CUSTOM_FORWARD_TTL',
    label: '转发 TTL 最小值',
    description: '设置 CUSTOM_FORWARD 的 TTL 最小值，0 表示不限制。',
    defaultValue: '0',
    type: 'number',
    min: 0,
    max: 604800,
    requiresCNAUTO: true,
    group: 'custom_forward',
  },
  {
    key: 'AUTO_FORWARD',
    label: '自动转发非 CN',
    description: '配合 CUSTOM_FORWARD 使用，非 CN 大陆 IP 域名直接转发到 CUSTOM_FORWARD。',
    defaultValue: 'no',
    type: 'select',
    options: [
      { value: 'no', label: '关闭' },
      { value: 'yes', label: '开启' },
    ],
    requiresCNAUTO: true,
    group: 'custom_forward',
  },
  {
    key: 'AUTO_FORWARD_CHECK',
    label: '自动转发前检查',
    description: 'AUTO_FORWARD=yes 时，转发前是否检查域名有效性，避免产生无效查询。',
    defaultValue: 'yes',
    type: 'select',
    options: [
      { value: 'yes', label: '开启检查' },
      { value: 'no', label: '不检查' },
    ],
    requiresCNAUTO: true,
    group: 'custom_forward',
  },
  {
    key: 'RULES_TTL',
    label: 'TTL 规则有效期',
    description: '值大于0时生效，将 force_ttl_rules.txt 中指定域名转发到指定 DNS 并修改 TTL。',
    defaultValue: '0',
    type: 'number',
    min: 0,
    max: 604800,
    requiresCNAUTO: true,
    group: 'custom_forward',
  },
  // advanced
  {
    key: 'USE_HOSTS',
    label: '读取 Hosts 文件',
    description: '启动时读取容器 /etc/hosts，可配合 docker --add-hosts 或 compose extra_hosts 使用。',
    defaultValue: 'no',
    type: 'select',
    options: [
      { value: 'no', label: '关闭' },
      { value: 'yes', label: '开启' },
    ],
    requiresCNAUTO: true,
    group: 'advanced',
  },
  {
    key: 'HTTP_FILE',
    label: 'HTTP 文件服务',
    description: '开启 7889 端口的 HTTP 静态文件服务器映射 /data 目录，可与其他服务共享文件。',
    defaultValue: 'no',
    type: 'select',
    options: [
      { value: 'no', label: '关闭' },
      { value: 'yes', label: '开启' },
    ],
    group: 'advanced',
  },
  {
    key: 'SHUFFLE',
    label: 'Round-robin 洗牌',
    description: '对解析结果洗牌实现负载均衡。lite=精简仅匹配类型回应；trnc=lite基础上超过3条仅输出3条随机记录。',
    defaultValue: 'no',
    type: 'select',
    options: [
      { value: 'no', label: '关闭' },
      { value: 'yes', label: '开启' },
      { value: 'lite', label: '精简模式 (lite)' },
      { value: 'trnc', label: '截断模式 (trnc)' },
    ],
    requiresCNAUTO: true,
    group: 'advanced',
  },
  {
    key: 'ADDINFO',
    label: '附加调试信息',
    description: '在 DNS 查询结果 ADDITIONAL SECTION 中增加调试信息（来源、延迟、失败原因），用 dig 可追踪。',
    defaultValue: 'no',
    type: 'select',
    options: [
      { value: 'no', label: '关闭' },
      { value: 'yes', label: '开启' },
    ],
    requiresCNAUTO: true,
    group: 'advanced',
  },
  // debug
  {
    key: 'SAFEMODE',
    label: '安全模式',
    description: '仅作调试使用，内存环境异常无法正常启动时尝试启用。',
    defaultValue: 'no',
    type: 'select',
    options: [
      { value: 'no', label: '关闭' },
      { value: 'yes', label: '开启' },
    ],
    group: 'debug',
  },
  {
    key: 'QUERY_TIME',
    label: '转发最大时间',
    description: '限制 DNS 转发最大时间，随意更改可能导致查不到结果。仅作调试使用。',
    defaultValue: '2000ms',
    type: 'text',
    placeholder: '2000ms',
    group: 'debug',
  },
];

export const GROUP_LABELS: Record<string, { label: string; icon: string }> = {
  basic: { label: '基础配置', icon: 'Settings' },
  cn_routing: { label: 'CN 分流', icon: 'GitBranch' },
  ipv6: { label: 'IPv6', icon: 'Globe' },
  custom_forward: { label: '自定义转发', icon: 'ArrowRightLeft' },
  advanced: { label: '高级选项', icon: 'Sliders' },
  debug: { label: '调试', icon: 'Bug' },
};

export const PORT_INFO = [
  { port: 53, protocol: 'TCP/UDP', description: 'DNS 服务端口', alwaysAvailable: true },
  { port: 5301, protocol: 'TCP/UDP', description: '递归 Unbound 端口（调试）', alwaysAvailable: false },
  { port: 5302, protocol: 'TCP/UDP', description: '原生 DNSCrypt 端口（调试）', alwaysAvailable: false },
  { port: 5303, protocol: 'TCP/UDP', description: 'SOCKS5 DNSCrypt 端口（调试）', alwaysAvailable: false },
  { port: 5304, protocol: 'TCP/UDP', description: 'DNSCrypt 缓存 Unbound 端口', alwaysAvailable: false },
  { port: 7889, protocol: 'TCP', description: 'HTTP 文件服务端口', alwaysAvailable: false },
];

export const LIST_FILE_INFO = [
  {
    key: 'force_forward_list',
    filename: 'force_forward_list.txt',
    title: '强制转发域名列表',
    description: '强制转发到 CUSTOM_FORWARD DNS 服务器的域名列表。需配置 CUSTOM_FORWARD 才生效。',
    requiresForward: true,
    defaultContent: `# 强制转发域名列表
# 语法: domain: | full: | regexp: | keyword: 开头
# domain: 匹配域名及子域名
# full: 精确匹配
# regexp: 正则匹配
# keyword: 关键字匹配
# 省略前缀默认为 domain:

domain:bing.com
domain:googleapis.cn
domain:xn--ngstr-lra8j.com
domain:gvt1.com
domain:android.googleapis.com
domain:play.googleapis.com`,
  },
  {
    key: 'force_dnscrypt_list',
    filename: 'force_dnscrypt_list.txt',
    title: '强制 DNSCrypt 域名列表',
    description: '强制使用 DNSCrypt 加密查询的域名列表。适合境外域名获取原始记录。',
    requiresForward: false,
    defaultContent: `# 强制 DNSCrypt 域名列表

domain:ip.03k.org
domain:msftncsi.com
domain:msftconnecttest.com
domain:time.windows.com
domain:ntp.msn.com
domain:time-ios.apple.com
domain:time.apple.com
domain:pool.ntp.org
domain:xbox.ipv6.microsoft.com
domain:xncsi.xboxlive.com
domain:x1ds.xboxlive.com`,
  },
  {
    key: 'force_recurse_list',
    filename: 'force_recurse_list.txt',
    title: '强制递归域名列表',
    description: '强制使用本地递归查询的域名列表。一般不建议使用，强制递归的域名不受 CNFALL 回退保护。',
    requiresForward: false,
    defaultContent: `# 强制递归域名列表
# 注意: 大部分场景不适用于此列表

domain:whoami.ds.akahelp.net
domain:whoami.03k.org
domain:nstool.netease.com
domain:ntp.aliyun.com
domain:time.edu.cn
domain:ntp.org.cn
domain:localhost.ptlogin2.qq.com
domain:localhost.sec.qq.com`,
  },
];

export interface TtlRule {
  domain: string;
  server: string;
  port: string;
  servers?: string; // comma-separated additional servers
}

export interface CustomModZone {
  zone: string;
  dns: string;
  ttl: number;
  seq: 'top' | 'top6' | 'list';
  socks5: 'yes' | 'no';
}

export interface CustomModSwap {
  env_key: string;
  cidr_file: string;
}

export interface CustomModHost {
  env_key: string;
  zone: string;
}

export interface CustomEnvEntry {
  key: string;
  value: string;
  enabled: boolean;
}
