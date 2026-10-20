/**
 * `npm run compat [-- --base <tag>] [--next <version>]`: what a game made on
 * an earlier release trips over in this tree.
 *
 * A game is a folder the engine never rewrites (scripts and modules written
 * against the declaration files, content/*.json, game.json, a .env) plus a
 * database. An upgrade swaps the engine under all of that, so anything that
 * stops accepting what the earlier release accepted is breaking, and semver
 * makes it a major. The comparison is with the release itself, read from
 * git, so there is no baseline to forget or for a minor to rewrite.
 *
 * `npm version` runs it before tagging (preversion) and refuses a bump
 * smaller than the changes need; the release workflow runs it again and
 * puts its output at the top of the release notes.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import ts from 'typescript';

function git(...args: string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/** A file as it was at `ref`, or undefined where it did not exist. */
function atRef(ref: string, file: string): string | undefined {
  try {
    return git('show', `${ref}:${file}`);
  } catch {
    return undefined;
  }
}

function filesAt(ref: string, ...paths: string[]): string[] {
  return git('ls-tree', '-r', '--name-only', ref, '--', ...paths)
    .split('\n')
    .filter(Boolean);
}

// ---- script API

/** What a game's scripts and modules are type-checked against. */
const API_FILES = ['scripts/global.d.ts', 'modules/clientEngine.d.ts'];

function declared(source: ts.SourceFile) {
  const values = new Set<string>();
  const types = new Set<string>();
  for (const s of source.statements) {
    if (ts.isFunctionDeclaration(s) && s.name) values.add(s.name.text);
    else if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations)
        values.add(d.name.getText(source));
    else if (ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s))
      types.add(s.name.text);
  }
  return { values, types };
}

// Two copies of one declaration file are two sets of types, and TypeScript
// compares nearly all of them structurally, which is what the check relies on.
// Two kinds it cannot: an interface branded with a `unique symbol` is nominal,
// so the earlier copy never matches the current one, and a generic type alias
// (a conditional or mapped type) left unresolved over a type parameter only
// relates to itself. Those are pointed at the current declaration; everything
// that uses them is still compared.
function pointedAtCurrent(
  s: ts.Statement,
  source: ts.SourceFile,
): s is ts.InterfaceDeclaration | ts.TypeAliasDeclaration {
  return (
    (ts.isTypeAliasDeclaration(s) && s.typeParameters !== undefined) ||
    (ts.isInterfaceDeclaration(s) &&
      s.members.some(
        (m) =>
          ts.isPropertySignature(m) &&
          m.type?.getText(source) === 'unique symbol',
      ))
  );
}

// The DOM and React lib files are most of what a program parses, and they are
// the same for every comparison.
const libFiles = new Map<string, ts.SourceFile | undefined>();

/**
 * What a script written against `previous` stops compiling against in
 * `current`: removed globals and types, and every global whose current
 * type cannot stand in for its earlier one.
 */
export function scriptApiBreaks(previous: string, current: string): string[] {
  const before = ts.createSourceFile(
    'previous.d.ts',
    previous,
    ts.ScriptTarget.Latest,
    true,
  );
  const was = declared(before);
  const now = declared(
    ts.createSourceFile('current.d.ts', current, ts.ScriptTarget.Latest, true),
  );
  const breaks: string[] = [];
  for (const t of was.types)
    if (!now.types.has(t)) breaks.push(`type ${t} was removed`);
  for (const v of was.values)
    if (!now.values.has(v)) breaks.push(`${v} was removed`);

  // The earlier file goes inside `namespace Previous`, so both versions live in
  // one program and each surviving global can be assigned to its earlier type:
  // `const x: typeof Previous.getPlayer = getPlayer` compiles exactly when a
  // call written for the earlier signature still type-checks, and a value the
  // engine hands over still has every field it had.
  const edits: [start: number, end: number, by: string][] = [];
  const aliases: { label: string; code: string }[] = [];
  for (const s of before.statements) {
    if (pointedAtCurrent(s, before) && now.types.has(s.name.text)) {
      const name = s.name.text;
      const params = s.typeParameters?.map((p) => p.getText(before));
      const decl = params ? `<${params.join(', ')}>` : '';
      const use = s.typeParameters
        ? `<${s.typeParameters.map((p) => p.name.text).join(', ')}>`
        : '';
      edits.push([
        s.getStart(before),
        s.end,
        `type ${name}${decl} = Current_${name}${use};`,
      ]);
      aliases.push({
        label: `type ${name}`,
        code: `type Current_${name}${decl} = ${name}${use};`,
      });
      continue;
    }
    const declare = (ts.canHaveModifiers(s) ? ts.getModifiers(s) : [])?.find(
      (m) => m.kind === ts.SyntaxKind.DeclareKeyword,
    );
    if (declare) edits.push([declare.getStart(before), declare.end, '']);
  }
  let inNamespace = previous;
  for (const [start, end, by] of edits.sort((a, b) => b[0] - a[0]))
    inNamespace = inNamespace.slice(0, start) + by + inNamespace.slice(end);

  const lines = [...was.values]
    .filter((v) => now.values.has(v))
    .map((v) => ({
      label: v,
      code: `const check_${v}: typeof Previous.${v} = ${v};`,
    }));
  // Hooks reach scripts through the generic `on`, so their payloads are
  // compared directly as well.
  if (was.types.has('HookPayloads') && now.types.has('HookPayloads'))
    lines.push({
      label: 'hooks',
      code: 'declare const hooks: HookPayloads; const check_hooks: Previous.HookPayloads = hooks;',
    });
  lines.push(...aliases);

  const files: Record<string, string> = {
    'current.d.ts': current,
    'previous.d.ts': `declare namespace Previous {\n${inNamespace}\n}\n`,
    'check.ts': lines.map((l) => l.code).join('\n'),
  };
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    types: ['react'],
  };
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, language, ...rest) => {
    const own = files[name];
    if (own !== undefined) return ts.createSourceFile(name, own, language);
    if (!libFiles.has(name)) libFiles.set(name, read(name, language, ...rest));
    return libFiles.get(name);
  };
  host.fileExists = (name) => name in files || ts.sys.fileExists(name);
  host.readFile = (name) => files[name] ?? ts.sys.readFile(name);

  const program = ts.createProgram(Object.keys(files), options, host);
  for (const d of ts.getPreEmitDiagnostics(program)) {
    const chain = ts
      .flattenDiagnosticMessageText(d.messageText, '\n')
      .split('\n');
    const reason = chain[chain.length - 1]!.trim();
    const line =
      d.file && d.start !== undefined
        ? d.file.getLineAndCharacterOfPosition(d.start).line
        : -1;
    const where =
      d.file?.fileName === 'check.ts'
        ? lines[line]?.label
        : (d.file?.fileName ?? 'program');
    breaks.push(`${where}: ${reason}`);
  }
  return [...new Set(breaks)];
}

// ---- modules

type Manifest = { enabledByDefault?: boolean };

/**
 * A game.json written by `new-game` lists the modules that existed when the
 * game was made; every module it does not name runs or not by its manifest's
 * default. So a default is part of every existing game's configuration.
 */
export function moduleBreaks(
  previous: Record<string, Manifest>,
  current: Record<string, Manifest>,
): string[] {
  const on = (m: Manifest) => m.enabledByDefault ?? true;
  const breaks: string[] = [];
  for (const [id, before] of Object.entries(previous)) {
    const now = current[id];
    if (!now) breaks.push(`module ${id} was removed`);
    else if (on(now) !== on(before))
      breaks.push(
        `module ${id} now defaults to ${on(now) ? 'on' : 'off'}, which switches it in every game whose game.json does not name it`,
      );
  }
  for (const [id, m] of Object.entries(current))
    if (!previous[id] && on(m))
      breaks.push(
        `new module ${id} defaults to on, so it starts running in every game whose game.json does not name it - give it "enabledByDefault": false`,
      );
  return breaks;
}

function manifests(
  ids: string[],
  read: (file: string) => string | undefined,
): Record<string, Manifest> {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      JSON.parse(read(`modules/${id}/module.json`) ?? '{}') as Manifest,
    ]),
  );
}

// ---- content and game.json

/**
 * The content packs and game.json files `base` shipped (the new-game
 * template, the demos, game.example.json), checked as this build's boot
 * checks a game's. They stand in for the games made on that release.
 */
async function shippedGameBreaks(base: string): Promise<string[]> {
  const { readContentPack } =
    await import('../src/server/contentPack/contentPack.js');
  const { loadGameConfig } = await import('../src/server/gameConfig.js');
  const files = filesAt(base, 'templates', 'demos', 'game.example.json');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aurkad-compat-'));
  const breaks: string[] = [];
  try {
    const packs = new Set(
      files
        .filter((f) => /(^|\/)content\/[^/]+\.json$/.test(f))
        .map((f) => path.posix.dirname(f)),
    );
    for (const dir of packs) {
      const out = path.join(tmp, dir);
      fs.mkdirSync(out, { recursive: true });
      for (const f of files)
        if (path.posix.dirname(f) === dir && f.endsWith('.json'))
          fs.writeFileSync(
            path.join(out, path.posix.basename(f)),
            atRef(base, f) ?? '',
          );
      const { problems } = readContentPack(out);
      breaks.push(...problems.slice(0, 5).map((p) => `${dir}/${p}`));
      if (problems.length > 5)
        breaks.push(`${dir}: ${problems.length - 5} more like these`);
    }

    for (const file of files) {
      if (file !== 'game.example.json' && !file.endsWith('/game.json'))
        continue;
      const out = path.join(tmp, 'config', file);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, 'game.json'), atRef(base, file) ?? '');
      try {
        loadGameConfig(out);
      } catch (e) {
        // One indented line per problem, under a heading about game.json.
        const lines = (e as Error).message
          .split('\n')
          .filter((l) => l.startsWith('  '));
        breaks.push(...lines.map((l) => `${file}: ${l.trim()}`));
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return breaks;
}

// ---- the report

export type Report = {
  breaks: string[];
  /** Set when the database schema version moves. */
  schema?: { from: number; to: number };
  composeChanged: boolean;
};

export type Bump = 'patch' | 'minor' | 'major';
const RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export function requiredBump(report: Report): Bump {
  if (report.breaks.length > 0) return 'major';
  // A patch is one an operator can always go back from, and past a schema bump
  // the earlier build refuses the database.
  if (report.schema) return 'minor';
  return 'patch';
}

export function bumpBetween(from: string, to: string): Bump {
  const parse = (v: string) =>
    v
      .replace(/^v/, '')
      .split('.')
      .map((n) => parseInt(n, 10));
  const a = parse(from);
  const b = parse(to);
  if (a[0] !== b[0]) return 'major';
  if (a[1] !== b[1]) return 'minor';
  return 'patch';
}

export function upgradeNotes(base: string, report: Report): string {
  const out = [
    `## Upgrading from ${base}`,
    '',
    'Change the version on the `image:` lines of `compose.yml` and run `docker compose up -d`; `game/` is never touched.',
  ];
  const steps: string[] = [];
  if (report.schema)
    steps.push(
      `- **Back up the database first.** The first boot moves it from schema version ${report.schema.from} to ${report.schema.to}, and ${base} refuses to start on it after that, so going back means restoring the backup.`,
    );
  if (report.composeChanged)
    steps.push(
      '- **`compose.yml` changed.** Download the one attached to this release and keep your `.env` and `game/`; changing only the version leaves the new parts out.',
    );
  if (steps.length > 0) out.push('', ...steps);
  if (report.breaks.length > 0)
    out.push(
      '',
      `**Breaking changes.** What a game made on ${base} may have to change:`,
      '',
      ...report.breaks.map((b) => `- ${b}`),
    );
  return out.join('\n');
}

const SCHEMA_FILE = 'src/server/services/dbService.ts';
const schemaVersion = (source: string | undefined) => {
  const m = source?.match(/DB_SCHEMA_VERSION = (\d+)/);
  return m ? Number(m[1]) : undefined;
};

// `.env.example` documents every variable the server reads.
const envNames = (source = '') =>
  new Set([...source.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!));

async function compare(base: string): Promise<Report> {
  const breaks: string[] = [];

  for (const subject of git(
    'log',
    '--no-merges',
    '--format=%s',
    `${base}..HEAD`,
  ).split('\n'))
    if (/^\w+(\([^)]*\))?!:/.test(subject))
      breaks.push(`${subject} (marked breaking)`);

  const api = (read: (file: string) => string | undefined) =>
    API_FILES.map((f) => read(f) ?? '').join('\n');
  breaks.push(
    ...scriptApiBreaks(
      api((f) => atRef(base, f)),
      api((f) => fs.readFileSync(f, 'utf8')),
    ).map((b) => `script API, ${b}`),
  );

  const baseModules = filesAt(base, 'modules').flatMap(
    (f) => f.match(/^modules\/([^/]+)\/module\.json$/)?.[1] ?? [],
  );
  const modules = fs
    .readdirSync('modules')
    .filter((id) => fs.existsSync(`modules/${id}/module.json`));
  breaks.push(
    ...moduleBreaks(
      manifests(baseModules, (f) => atRef(base, f)),
      manifests(modules, (f) => fs.readFileSync(f, 'utf8')),
    ),
  );

  breaks.push(...(await shippedGameBreaks(base)));

  const env = envNames(fs.readFileSync('.env.example', 'utf8'));
  for (const name of envNames(atRef(base, '.env.example')))
    if (!env.has(name))
      breaks.push(
        `.env.example no longer has ${name}: a .env that sets it stops having an effect`,
      );

  const to = schemaVersion(fs.readFileSync(SCHEMA_FILE, 'utf8'));
  if (to === undefined)
    throw new Error(`DB_SCHEMA_VERSION is no longer in ${SCHEMA_FILE}`);
  const from = schemaVersion(atRef(base, SCHEMA_FILE)) ?? to;

  return {
    breaks,
    schema: from !== to ? { from, to } : undefined,
    composeChanged:
      atRef(base, 'compose.game.yml') !==
      fs.readFileSync('compose.game.yml', 'utf8'),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { base: { type: 'string' }, next: { type: 'string' } },
  });
  let base = values.base;
  if (!base) {
    try {
      base = git('describe', '--tags', '--abbrev=0', '--match', 'v*').trim();
    } catch {
      console.log('No earlier release to compare with.');
      return;
    }
  }
  try {
    git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
  } catch {
    throw new Error(`${base} is not in this clone (git fetch --tags)`);
  }

  const report = await compare(base);
  console.log(upgradeNotes(base, report));

  if (values.next) {
    const needed = requiredBump(report);
    const chosen = bumpBetween(base, values.next);
    if (RANK[chosen] < RANK[needed]) {
      console.error(
        `\n${values.next} is a ${chosen} release after ${base}, and the changes above need a ${needed}: ` +
          `run npm version ${needed}, or keep accepting what ${base} accepted.`,
      );
      process.exitCode = 1;
    }
  }
}

// Only as a CLI: the checks above are imported by compat.test.ts. The server
// modules the content check loads keep handles open, so it exits explicitly.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().then(
    () => process.exit(),
    (e: unknown) => {
      console.error(e);
      process.exit(1);
    },
  );
}
