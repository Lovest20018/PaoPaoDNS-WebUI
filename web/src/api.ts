const API_BASE = '';

function getToken(): string {
  try {
    return localStorage.getItem('paopaodns-token') || '';
  } catch {
    return '';
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (response.status === 401) throw new Error('Unauthorized — 请检查 WEB_UI_TOKEN');
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export interface SystemStatus {
  data_dir: string;
  data_readable: boolean;
  data_writable: boolean;
  auth_enabled: boolean;
}

export interface ConfigInfo {
  filename: string;
  exists: boolean;
  auto_reload: boolean;
  requires_reload: boolean;
  requires_restart: boolean;
  condition: string;
}

export interface FileContent extends ConfigInfo {
  content: string;
}

export interface SaveResult extends ConfigInfo {
  message: string;
}

export const getStatus = () => apiFetch<SystemStatus>('/api/status');
export const getConfigs = () => apiFetch<ConfigInfo[]>('/api/configs');
export const readConfig = (filename: string) => apiFetch<FileContent>(`/api/configs/${filename}`);
export const writeConfig = (filename: string, content: string) => apiFetch<SaveResult>(`/api/configs/${filename}`, {
  method: 'PUT',
  body: JSON.stringify({ content }),
});

export function setToken(token: string): void {
  try {
    if (token) localStorage.setItem('paopaodns-token', token);
    else localStorage.removeItem('paopaodns-token');
  } catch {
    // A restricted browser can still retry without persisted credentials.
  }
}

export const getStoredToken = getToken;
