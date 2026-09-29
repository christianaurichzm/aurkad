import fs from 'node:fs';
import path from 'node:path';
import { SCRIPT_API_DIR, SCRIPTS_DIR, isScriptFile } from './loader.js';

// fs layer behind the Monaco script editor. The server runs what is written
// here (loader.ts hot-reloads SCRIPTS_DIR), so every function is a remote
// code write. Callers MUST gate on SCRIPT_EDITOR_ENABLED and ADMIN access.

const NAME_RE = /^[A-Za-z0-9_-]+\.(js|ts)$/;

export function isValidScriptName(name: string): boolean {
  return NAME_RE.test(name);
}

export interface ScriptFileInfo {
  name: string;
  size: number;
  mtimeMs: number;
}

export function listScriptFiles(): ScriptFileInfo[] {
  if (!fs.existsSync(SCRIPTS_DIR)) return [];
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter(isScriptFile)
    .map((name) => {
      const stat = fs.statSync(path.join(SCRIPTS_DIR, name));
      return { name, size: stat.size, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readScriptFile(name: string): string | null {
  if (!isValidScriptName(name)) return null;
  const filePath = path.join(SCRIPTS_DIR, name);
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeScriptFile(name: string, content: string): boolean {
  if (!isValidScriptName(name)) return false;
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCRIPTS_DIR, name), content, 'utf-8');
  return true;
}

export function createScriptFile(
  name: string,
  content = '',
): 'created' | 'invalid' | 'exists' {
  if (!isValidScriptName(name)) return 'invalid';
  const filePath = path.join(SCRIPTS_DIR, name);
  if (fs.existsSync(filePath)) return 'exists';
  fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return 'created';
}

export function deleteScriptFile(name: string): boolean {
  if (!isValidScriptName(name)) return false;
  const filePath = path.join(SCRIPTS_DIR, name);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

export interface ScriptTypeDefs {
  globalDts: string;
  contentDts: string;
}

// Best-effort: a read-only scripts/ mount just means empty editor autocomplete.
export function readTypeDefs(): ScriptTypeDefs {
  const read = (file: string): string => {
    try {
      return fs.readFileSync(file, 'utf-8');
    } catch {
      return '';
    }
  };
  return {
    globalDts: read(path.join(SCRIPT_API_DIR, 'global.d.ts')),
    contentDts: read(path.join(SCRIPTS_DIR, 'content.generated.d.ts')),
  };
}
