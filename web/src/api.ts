const API_BASE = '';

function getToken(): string {
  try {
    return localStorage.getItem('paopaodns-token') || '';
  } catch {
    // localStorage can be unavailable in restricted browser contexts.
    return '';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  // Merge caller headers but preserve Authorization
  if (options?.headers) {
    const callerHeaders = new Headers(options.headers);
    callerHeaders.forEach((value, key) => {
      if (key.toLowerCase() !== 'authorization' || !token) {
        headers.set(key, value);
      }
    });
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });
  if (res.status === 401) {
    throw new Error('Unauthorized — 请检查 WEB_UI_TOKEN 配置');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export interface SystemStatus {
  data_dir: string;
  data_readable: boolean;
  data_writable: boolean;
  auth_enabled: boolean;
  dns_test?: {
    server: string;
    port: number;
    timeout: number;
  };
  env: Record<string, string>;
  files: Record<string, boolean>;
  files_info: Record<string, {
    exists: boolean;
    auto_reload: boolean;
    requires_reload: boolean;
    requires_restart: boolean;
    watched_now: boolean;
    condition: string;
  }>;
}

export interface FileContent {
  filename: string;
  content: string;
  auto_reload: boolean;
  requires_reload: boolean;
  requires_restart: boolean;
  watched_now: boolean;
  condition: string;
}

export interface SaveResult {
  message: string;
  filename: string;
  auto_reload: boolean;
  requires_reload: boolean;
  requires_restart: boolean;
  watched_now: boolean;
  condition: string;
}

export interface DnsAnswer {
  name: string;
  type: string;
  ttl: number;
  value: string;
  class?: number;
}

export interface DnsTestResult {
  available: boolean;
  domain: string;
  record_type: 'A' | 'AAAA' | 'CNAME';
  server: string;
  port: number;
  elapsed_ms?: number;
  rcode?: string;
  answers: DnsAnswer[];
  results: string[];
  error?: string;
}

export interface HealthCheckResult {
  pass: boolean;
  server: string;
  port: number;
  error?: string;
  tests: Record<string, {
    domain: string;
    resolved: boolean;
    result?: DnsTestResult;
  }>;
}

export async function getStatus(): Promise<SystemStatus> {
  return apiFetch<SystemStatus>('/api/status');
}

export async function getEnv(): Promise<Record<string, string>> {
  return apiFetch<Record<string, string>>('/api/env');
}

export async function readFile(filename: string): Promise<FileContent> {
  return apiFetch<FileContent>(`/api/file/${filename}`);
}

export async function writeFile(filename: string, content: string): Promise<SaveResult> {
  return apiFetch<SaveResult>(`/api/file/${filename}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export async function runDnsTest(params: {
  domain: string;
  record_type: 'A' | 'AAAA' | 'CNAME';
  server?: string;
  port?: number;
}): Promise<DnsTestResult> {
  return apiFetch<DnsTestResult>('/api/dns-test', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function runHealthCheck(params?: { server?: string; port?: number }): Promise<HealthCheckResult> {
  const query = new URLSearchParams();
  if (params?.server) query.set('server', params.server);
  if (params?.port) query.set('port', String(params.port));
  const suffix = query.toString() ? `?${query.toString()}` : '';
  return apiFetch<HealthCheckResult>(`/api/health-check${suffix}`);
}

export function setToken(token: string): void {
  try {
    if (token) {
      localStorage.setItem('paopaodns-token', token);
    } else {
      localStorage.removeItem('paopaodns-token');
    }
  } catch {
    // Ignore storage failures; the current request can still proceed without a token.
  }
}

export function getStoredToken(): string {
  return getToken();
}
