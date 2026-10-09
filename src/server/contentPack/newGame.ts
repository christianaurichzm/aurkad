/**
 * `npm run new-game -- <folder>`, or the `new-game` service of
 * compose.game.yml: a game folder that boots into a meadow with a few
 * monsters, loot and art in every sheet, so a creator replaces pieces of a
 * working game instead of facing a black canvas. Point GAME_DIR at it.
 * Compiled with the server so the image runs it without the dev toolchain.
 *
 * The game is a copy of templates/new-game: game/ for every game, then the
 * map and sheets of orthogonal/ or isometric/ over it. The art is KayKit's
 * (CC0), rendered and laid out by templates/new-game/build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { MapOrientation } from '../../shared/types.js';

// Beside modules/, from where the engine runs: the repository's root, or
// the image's /app.
export const TEMPLATE = path.resolve('templates/new-game');

const titleCase = (folder: string) =>
  folder
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (ch) => ch.toUpperCase())
    .trim()
    .slice(0, 40);

// Every official module, switched off: the game starts as the engine alone,
// and its game.json lists what there is to turn on. Read from the engine's
// modules/ as the loader finds it, so a module added later is listed too.
function modulesOff(): Record<string, { enabled: false }> {
  const dir = process.env.MODULES_PATH ?? 'modules';
  if (!fs.existsSync(dir)) return {};
  return Object.fromEntries(
    fs
      .readdirSync(dir)
      .filter((id) => fs.existsSync(path.join(dir, id, 'module.json')))
      .map((id) => [id, { enabled: false }]),
  );
}

export function writeGame(
  dir: string,
  name = titleCase(path.basename(dir)) || 'New Game',
  orientation: MapOrientation = 'orthogonal',
): void {
  fs.cpSync(path.join(TEMPLATE, 'game'), dir, { recursive: true });
  fs.cpSync(path.join(TEMPLATE, orientation), dir, { recursive: true });
  const file = path.join(dir, 'game.json');
  const template = JSON.parse(fs.readFileSync(file, 'utf8')) as object;
  fs.writeFileSync(
    file,
    `${JSON.stringify({ brand: { name }, ...template, modules: modulesOff() }, null, 2)}\n`,
  );
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { isometric: { type: 'boolean' } },
  });
  const [arg, name] = positionals;
  if (!arg) {
    console.error(
      'Usage: npm run new-game -- <folder> ["Game Name"] [--isometric]',
    );
    process.exit(1);
  }
  const dir = path.resolve(arg);
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    console.error(`${arg} already has files in it; pick a new folder.`);
    process.exit(1);
  }
  writeGame(dir, name, values.isometric ? 'isometric' : 'orthogonal');
  console.log(
    `Created ${arg}: a meadow, three kinds of npc, five items, a script to start from, and art to build on (KayKit, CC0).\n` +
      `Run the engine with GAME_DIR pointing at it; its name and logo are brand in game.json.\n` +
      `In development the first account registered is the admin; in production, the one named by BOOTSTRAP_ADMIN_USERNAME.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
