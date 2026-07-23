import { httpClient } from './httpClient';

export interface ScriptFileInfo {
  name: string;
  size: number;
  mtimeMs: number;
}

export interface ScriptTypeDefs {
  globalDts: string;
  contentDts: string;
}

export async function listScripts(): Promise<ScriptFileInfo[]> {
  return (
    (await httpClient<ScriptFileInfo[]>('/admin/scripts', {
      method: 'GET',
    })) ?? []
  );
}

export async function getScriptTypes(): Promise<ScriptTypeDefs> {
  return (
    (await httpClient<ScriptTypeDefs>('/admin/scripts/types', {
      method: 'GET',
    })) ?? { globalDts: '', contentDts: '' }
  );
}

export async function getScript(name: string): Promise<string> {
  const res = await httpClient<{ name: string; content: string }>(
    `/admin/scripts/${encodeURIComponent(name)}`,
    { method: 'GET' },
  );
  return res?.content ?? '';
}

export async function saveScript(
  name: string,
  content: string,
): Promise<boolean> {
  const res = await httpClient(`/admin/scripts/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: { content },
  }).catch(() => null);
  return res !== null;
}

export async function createScript(name: string): Promise<boolean> {
  const res = await httpClient('/admin/scripts', {
    method: 'POST',
    body: { name },
  }).catch(() => null);
  return res !== null;
}

export async function deleteScript(name: string): Promise<boolean> {
  const res = await httpClient(`/admin/scripts/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  }).catch(() => null);
  return res !== null;
}
