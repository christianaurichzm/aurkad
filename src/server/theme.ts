import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  THEME_CORNERS,
  THEME_FONTS,
  THEME_LAYOUTS,
  themeTokens,
  type ThemeImage,
} from '../shared/theme.js';
import { logger } from './logger.js';

// How a game looks, for a creator who writes no CSS: theme/theme.json,
// beside the theme.css of one who does. Colours, corners, a font and the
// menu's place come from short lists of validated values (a hex, an enum,
// never CSS text), so a page in the app may write the file. The server
// turns it into :root variables at the head of /theme/theme.css, so a
// hand-written theme.css still wins over it.

const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
const keys = <T extends object>(of: T) => Object.keys(of) as (keyof T)[];

// A picture the Appearance page uploaded: named by its slot and content,
// so a new one is a new URL and no browser keeps showing the last one.
const IMAGE_EXTENSIONS = ['png', 'jpg', 'webp'] as const;
const uploaded = (slot: ThemeImage) =>
  new RegExp(`^${slot}-[0-9a-f]{8}\\.(${IMAGE_EXTENSIONS.join('|')})$`);

const ThemeSchema = z.strictObject({
  colors: z
    .strictObject({
      primary: hex,
      accent: hex,
      background: hex,
      surface: hex,
      text: hex,
      danger: hex,
    })
    .partial()
    .default({}),
  corners: z.enum(keys(THEME_CORNERS)).optional(),
  font: z.enum(keys(THEME_FONTS)).optional(),
  // Beside the world on the right or the left, or in a bar under it. A phone
  // has its own arrangement (styles.css) whichever is picked.
  layout: z.enum(THEME_LAYOUTS).default('right'),
  // Whether the world darkens behind a conversation. Off for a game where
  // what goes on behind the box is part of the scene.
  dialogDim: z.boolean().default(true),
  // Over game.json's brand.logo, which a game that uploads none keeps.
  logo: z.string().regex(uploaded('logo')).optional(),
  // Behind the login card.
  background: z.string().regex(uploaded('background')).optional(),
});

/** What the Appearance page saves; pictures arrive through saveThemeImage. */
export const ThemeChoicesSchema = ThemeSchema.omit({
  logo: true,
  background: true,
});

export type Theme = z.infer<typeof ThemeSchema>;
const DEFAULT_THEME = ThemeSchema.parse({});

/** The :root block `theme` asks for; empty for a game asking for nothing. */
export function themeVariables(theme: Theme): string {
  const vars = themeTokens(theme).map(
    ([token, value]) => `${token}: ${value};`,
  );
  return vars.length ? `:root {\n  ${vars.join('\n  ')}\n}\n` : '';
}

// Read again only when the file's mtime moves, so a page saving it takes
// effect without a restart and a request costs one stat.
const cache = new Map<string, { mtimeMs: number; theme: Theme }>();

/**
 * theme/theme.json as it stands. A file that is missing, or is not valid, is
 * a game with the defaults: the login screen has to come up, and the reason is
 * in the log, once per change of the file.
 */
export async function readTheme(dir: string): Promise<Theme> {
  const file = path.join(dir, 'theme.json');
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(file)).mtimeMs;
  } catch {
    cache.delete(file);
    return DEFAULT_THEME;
  }
  const hit = cache.get(file);
  if (hit?.mtimeMs === mtimeMs) return hit.theme;

  let theme = DEFAULT_THEME;
  try {
    theme = ThemeSchema.parse(JSON.parse(await readFile(file, 'utf8')));
  } catch (err) {
    logger.warn('theme.json ignored: not valid', {
      file,
      reason: err instanceof z.ZodError ? z.prettifyError(err) : String(err),
    });
  }
  cache.set(file, { mtimeMs, theme });
  return theme;
}

const themeFile = (dir: string) => path.join(dir, 'theme.json');

// Read, change, write with no lock: two admins saving in the same instant
// keep the later one's file whole and lose the earlier one's change.
async function store(dir: string, theme: Theme): Promise<Theme> {
  const file = themeFile(dir);
  await mkdir(dir, { recursive: true });
  // Renamed into place, so a request reading it never finds half a file.
  await writeFile(`${file}.tmp`, `${JSON.stringify(theme, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
  // Two writes can land inside one tick of a coarse filesystem clock, and the
  // mtime would then vouch for the first.
  cache.delete(file);
  return theme;
}

/** Saves the choices of the Appearance page, keeping the pictures in place. */
export async function writeTheme(
  dir: string,
  choices: z.infer<typeof ThemeChoicesSchema>,
): Promise<Theme> {
  const { logo, background } = await readTheme(dir);
  return store(dir, { ...choices, logo, background });
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ascii = (bytes: Buffer, from: number, to: number) =>
  bytes.toString('latin1', from, to);

// By what the file starts with, never by the name or the type the upload
// claims: express.static answers with a type taken from the extension this
// picks, so the extension has to be the truth.
const imageExtension = (bytes: Buffer) =>
  bytes.subarray(0, 8).equals(PNG)
    ? 'png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? 'jpg'
      : ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
        ? 'webp'
        : undefined;

async function dropImages(dir: string, slot: ThemeImage, keep?: string) {
  const names = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(
    names
      .filter((name) => name !== keep && uploaded(slot).test(name))
      .map((name) => unlink(path.join(dir, name)).catch(() => {})),
  );
}

/**
 * Puts `bytes` in theme/ as the game's logo or login background and points
 * theme.json at it. Undefined, and nothing written, for bytes that are not a
 * PNG, a JPEG or a WebP.
 */
export async function saveThemeImage(
  dir: string,
  slot: ThemeImage,
  bytes: Buffer,
): Promise<Theme | undefined> {
  const extension = imageExtension(bytes);
  if (!extension) return undefined;
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 8);
  const name = `${slot}-${digest}.${extension}`;
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), bytes);
  const theme = await store(dir, { ...(await readTheme(dir)), [slot]: name });
  await dropImages(dir, slot, name);
  return theme;
}

/** Takes an uploaded picture away; a logo goes back to game.json's. */
export async function removeThemeImage(
  dir: string,
  slot: ThemeImage,
): Promise<Theme> {
  const theme = await store(dir, {
    ...(await readTheme(dir)),
    [slot]: undefined,
  });
  await dropImages(dir, slot);
  return theme;
}
