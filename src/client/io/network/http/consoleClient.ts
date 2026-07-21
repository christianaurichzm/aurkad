import { httpClient } from './httpClient';
import { silentAction } from './authClient';

export interface CommandInfo {
  name: string;
  access: number;
  description: string;
}

// Authorize opening the console (admin only). Reuses the gated commands
// endpoint so no separate authorize route is needed.
export async function openConsole(): Promise<boolean> {
  const res = await silentAction(
    httpClient('/admin/commands', { method: 'GET' }),
  );
  return !!res;
}

export async function fetchCommands(): Promise<CommandInfo[]> {
  return (
    (await httpClient<CommandInfo[]>('/admin/commands', { method: 'GET' })) ??
    []
  );
}

export async function runConsoleCommand(line: string): Promise<string[]> {
  const res = await httpClient<{ output: string[] }>('/admin/console', {
    method: 'POST',
    body: { line },
  });
  return res?.output ?? [];
}
