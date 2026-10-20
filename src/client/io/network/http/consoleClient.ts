import { httpClient } from './httpClient';
import { Access } from '../../../../shared/types';

export interface CommandInfo {
  name: string;
  access: Access;
  description: string;
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
