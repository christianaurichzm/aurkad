import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadModules,
  unloadAllModules,
  getClientModules,
  readModuleClientFile,
  readClientSource,
} from './moduleLoader.js';
import { initTsSupport } from '../scripting/loader.js';
import { handleReplCommand, clearCommands } from '../commands.js';
import { clearProvides, isProvided } from './registry.js';

let tmpDir: string;

function writeModule(
  id: string,
  manifest: object,
  server: string,
  root = tmpDir,
) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'module.json'),
    JSON.stringify({
      id,
      name: id,
      version: '1.0.0',
      server: 'server.js',
      ...manifest,
    }),
  );
  fs.writeFileSync(path.join(dir, 'server.js'), server);
}

async function repl(name: string, args: string[] = []): Promise<string[]> {
  const out: string[] = [];
  await handleReplCommand(name, args, (s) => out.push(s));
  return out;
}

beforeEach(() => {
  clearCommands();
  clearProvides();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'modules-'));
  process.env.MODULES_PATH = tmpDir;
});

afterEach(() => {
  unloadAllModules();
  clearCommands();
  clearProvides();
  delete process.env.MODULES_PATH;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (process.env.GAME_DIR) {
    fs.rmSync(process.env.GAME_DIR, { recursive: true, force: true });
    delete process.env.GAME_DIR;
  }
});

describe('loadModules', () => {
  it('loads an enabled module and injects its config', async () => {
    writeModule(
      'echo',
      { config: { greeting: 'hello' } },
      `command('echo', {}, ({ reply }) => reply(config.greeting));`,
    );

    loadModules();

    expect(await repl('echo')).toEqual(['hello']);
  });

  it('does not load a module disabled by default', async () => {
    writeModule(
      'secret',
      { enabledByDefault: false },
      `command('secret', {}, ({ reply }) => reply('loaded'));`,
    );

    loadModules();

    // Command was never registered, so the REPL reports it as unhandled.
    const out: string[] = [];
    expect(await handleReplCommand('secret', [], (s) => out.push(s))).toBe(
      false,
    );
  });

  it('unloadAllModules unregisters what a module registered', async () => {
    writeModule('echo', {}, `command('echo', {}, ({ reply }) => reply('hi'));`);
    loadModules();
    expect(await repl('echo')).toEqual(['hi']);

    unloadAllModules();

    const out: string[] = [];
    expect(await handleReplCommand('echo', [], (s) => out.push(s))).toBe(false);
  });

  it('skips a module folder with an invalid manifest', async () => {
    const dir = path.join(tmpDir, 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'module.json'), '{ not valid json');
    fs.writeFileSync(
      path.join(dir, 'server.js'),
      `command('broken', {}, () => {});`,
    );

    expect(() => loadModules()).not.toThrow();
    const out: string[] = [];
    expect(await handleReplCommand('broken', [], (s) => out.push(s))).toBe(
      false,
    );
  });

  it("adds a game folder's modules to the official ones, its copy winning", async () => {
    process.env.GAME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'game-'));
    const own = path.join(process.env.GAME_DIR, 'modules');
    const says = (id: string, text: string) =>
      `command('${id}', {}, ({ reply }) => reply('${text}'));`;
    writeModule('bank', {}, says('bank', 'official'));
    writeModule('guild', {}, says('guild', 'official'));
    writeModule('guild', {}, says('guild', 'game'), own);
    writeModule('puzzle', { client: 'client.js' }, says('puzzle', 'game'), own);
    fs.writeFileSync(path.join(own, 'puzzle', 'client.js'), 'engine.mount();');

    loadModules();

    expect(await repl('bank')).toEqual(['official']);
    expect(await repl('guild')).toEqual(['game']);
    expect(await repl('puzzle')).toEqual(['game']);
    expect(readModuleClientFile('puzzle')).toBe('engine.mount();');
  });

  it('does nothing when modules dir is absent', () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    expect(() => loadModules()).not.toThrow();
  });
});

describe('inter-module API', () => {
  it('a dependent loads after its dependency and consumes its API', async () => {
    writeModule(
      'provider',
      {},
      `provide('greeter', { hello: () => 'hi from provider' });`,
    );
    writeModule(
      'consumer',
      { dependencies: ['provider'] },
      `const g = use('greeter');
       command('greet', {}, ({ reply }) => reply(g.hello()));`,
    );

    loadModules();

    expect(await repl('greet')).toEqual(['hi from provider']);
  });

  it('skips a module whose dependency is disabled', async () => {
    writeModule(
      'provider',
      { enabledByDefault: false }, // disabled
      `provide('greeter', { hello: () => 'hi' });`,
    );
    writeModule(
      'consumer',
      { dependencies: ['provider'] },
      `command('greet', {}, ({ reply }) => reply('loaded'));`,
    );

    loadModules();

    expect(isProvided('greeter')).toBe(false);
    const out: string[] = [];
    expect(await handleReplCommand('greet', [], (s) => out.push(s))).toBe(
      false,
    ); // consumer skipped
  });

  it('skips a module whose dependency threw on the way up', async () => {
    writeModule(
      'provider',
      {},
      `throw new Error('boom'); // provide() below never runs
       provide('greeter', { hello: () => 'hi' });`,
    );
    writeModule(
      'consumer',
      { dependencies: ['provider'] },
      `command('greet', {}, ({ reply }) => reply('loaded'));`,
    );

    loadModules();

    expect(isProvided('greeter')).toBe(false);
    const out: string[] = [];
    expect(await handleReplCommand('greet', [], (s) => out.push(s))).toBe(
      false,
    );
  });

  it('does not serve the client half of a module whose server entry threw', () => {
    const dir = path.join(tmpDir, 'halfdead');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'module.json'),
      JSON.stringify({
        id: 'halfdead',
        name: 'halfdead',
        version: '1.0.0',
        server: 'server.js',
        client: 'client.js',
      }),
    );
    fs.writeFileSync(path.join(dir, 'server.js'), `throw new Error('boom');`);
    fs.writeFileSync(path.join(dir, 'client.js'), `engine.mount();`);

    loadModules();

    expect(getClientModules()).toEqual([]);
    expect(readModuleClientFile('halfdead')).toBeNull();
  });

  it('unload withdraws a module provided API', () => {
    writeModule('provider', {}, `provide('greeter', { hello: () => 'hi' });`);
    loadModules();
    expect(isProvided('greeter')).toBe(true);

    unloadAllModules();
    expect(isProvided('greeter')).toBe(false);
  });
});

describe('client entries', () => {
  function writeClientModule(id: string, clientCode: string) {
    const dir = path.join(tmpDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'module.json'),
      JSON.stringify({
        id,
        name: id,
        version: '1.0.0',
        server: 'server.js',
        client: 'client.js',
      }),
    );
    fs.writeFileSync(path.join(dir, 'server.js'), '');
    fs.writeFileSync(path.join(dir, 'client.js'), clientCode);
  }

  it('lists only loaded modules that declare a client entry', () => {
    writeClientModule('hasclient', `engine.log('hi');`);
    writeModule('noclient', {}, '');
    loadModules();

    expect(getClientModules()).toEqual([
      { id: 'hasclient', client: 'client.js' },
    ]);
  });

  it('serves the declared client file', () => {
    writeClientModule('hasclient', `engine.mount();`);
    loadModules();

    expect(readModuleClientFile('hasclient')).toBe('engine.mount();');
  });

  it('returns null for a module that is not loaded', () => {
    expect(readModuleClientFile('ghost')).toBeNull();
  });

  it('serves a .jsx entry compiled, and recompiles it once edited', async () => {
    await initTsSupport();
    const file = path.join(tmpDir, 'client.jsx');
    fs.writeFileSync(file, 'engine.render(<b>hi</b>);');
    expect(readClientSource(file)).toContain(
      'React.createElement("b", null, "hi")',
    );
    fs.writeFileSync(file, 'engine.render(<i>hi</i>);');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
    expect(readClientSource(file)).toContain('React.createElement("i"');
  });

  it('serves a .jsx that does not compile as a throw naming the line', async () => {
    await initTsSupport();
    const file = path.join(tmpDir, 'client.jsx');
    fs.writeFileSync(file, '\nengine.render(<div><span></div>);');
    const code = readClientSource(file);
    expect(() => vm.runInNewContext(code)).toThrow(
      "client.jsx(2,21): JSX element 'span' has no corresponding closing tag.",
    );
  });

  it('refuses a client path that escapes the module dir', () => {
    const dir = path.join(tmpDir, 'evil');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'module.json'),
      JSON.stringify({
        id: 'evil',
        name: 'evil',
        version: '1',
        server: 'server.js',
        client: '../../secret.js',
      }),
    );
    fs.writeFileSync(path.join(dir, 'server.js'), '');
    loadModules();

    // The traversal guard rejects before ever touching the filesystem.
    expect(readModuleClientFile('evil')).toBeNull();
  });
});

// A minimap or a day/night tint has nothing to run on the server. It is still
// a module: listed, toggled by game.json, and its browser half served.
describe('client-only modules', () => {
  function writeClientOnly(id: string, manifest: object = {}) {
    const dir = path.join(tmpDir, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'module.json'),
      JSON.stringify({
        id,
        name: id,
        version: '1.0.0',
        client: 'client.js',
        enabledByDefault: true,
        ...manifest,
      }),
    );
    fs.writeFileSync(path.join(dir, 'client.js'), '/* drawing only */');
  }

  it('loads a module that declares only a client entry', () => {
    // Not a real module id: game.json in this repo lists minimap and daynight,
    // and isModuleEnabled would read that instead of the manifest here.
    writeClientOnly('drawonly');

    loadModules();

    expect(getClientModules()).toContainEqual({
      id: 'drawonly',
      client: 'client.js',
    });
    expect(readModuleClientFile('drawonly')).toContain('drawing only');
  });

  it('refuses a manifest that declares neither entry', () => {
    const dir = path.join(tmpDir, 'empty');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'module.json'),
      JSON.stringify({
        id: 'empty',
        name: 'empty',
        version: '1.0.0',
        enabledByDefault: true,
      }),
    );

    loadModules();

    expect(getClientModules()).toEqual([]);
    expect(readModuleClientFile('empty')).toBeNull();
  });
});
