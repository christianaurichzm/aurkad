import { httpClient } from './httpClient';

export interface AuditRecord {
  at: number;
  actor?: string;
  actorAccess?: number;
  requiredAccess?: number;
  action: string;
  target?: string;
  outcome: 'allowed' | 'denied';
  status?: number;
  source: 'http' | 'chat' | 'repl' | 'web' | 'script';
  ip?: string;
  details?: Record<string, unknown>;
}

export interface AuditFilter {
  actor?: string;
  action?: string;
  outcome?: 'allowed' | 'denied';
  before?: number;
  limit?: number;
}

export async function fetchAuditLog(
  filter: AuditFilter = {},
): Promise<AuditRecord[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== '') query.set(key, String(value));
  }
  const params = query.toString();
  const suffix = params ? `?${params}` : '';
  return (
    (await httpClient<AuditRecord[]>(`/admin/audit${suffix}`, {
      method: 'GET',
    })) ?? []
  );
}
