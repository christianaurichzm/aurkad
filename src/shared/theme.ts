// What theme/theme.json can say, and the :root variables each choice becomes.
// Shared because the Appearance page previews a draft with the very variables
// the server writes for it once saved.
//
// Six colours are asked for; the other tokens of the contract are mixed from
// them, so a game that picks a surface gets a border and a muted surface that
// belong with it.

export const THEME_TOKENS = {
  primary: '--color-primary',
  accent: '--color-accent',
  background: '--color-app-bg',
  surface: '--color-surface',
  text: '--color-text',
  danger: '--color-danger',
} as const;

export type ThemeColor = keyof typeof THEME_TOKENS;

/** Control and panel radius, in px. */
export const THEME_CORNERS = {
  square: [0, 0],
  soft: [4, 6],
  round: [8, 12],
} as const;

export const THEME_FONTS = {
  system: 'system-ui, sans-serif',
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'Cascadia Code', monospace",
} as const;

export const THEME_LAYOUTS = ['right', 'left', 'bottom'] as const;

/** Pictures a game can upload, each a file in theme/ named by its slot. */
export const THEME_IMAGES = ['logo', 'background'] as const;
export type ThemeImage = (typeof THEME_IMAGES)[number];

export type Theme = {
  colors?: Partial<Record<ThemeColor, string>>;
  corners?: keyof typeof THEME_CORNERS;
  font?: keyof typeof THEME_FONTS;
  layout: (typeof THEME_LAYOUTS)[number];
  dialogDim: boolean;
  logo?: string;
  background?: string;
};

const mix = (a: string, b: string) => `color-mix(in srgb, ${a}, ${b})`;

// A token that follows from the colours a game picked, written when any of
// them is picked and not before: a game that picks none keeps the engine's own
// values, which are drawn by hand and not the mixes below.
const DERIVED: [token: string, value: string, from: ThemeColor[]][] = [
  [
    '--color-primary-hover',
    mix('var(--color-primary)', 'white 12%'),
    ['primary'],
  ],
  [
    '--color-selected',
    mix('var(--color-primary) 30%', 'var(--color-surface)'),
    ['primary', 'surface'],
  ],
  [
    '--color-surface-muted',
    mix('var(--color-surface) 65%', 'var(--color-app-bg)'),
    ['surface', 'background'],
  ],
  [
    '--surface-control',
    mix('var(--color-surface)', 'var(--color-text) 6%'),
    ['surface', 'text'],
  ],
  [
    '--color-border',
    mix('var(--color-surface)', 'var(--color-text) 15%'),
    ['surface', 'text'],
  ],
  [
    '--color-text-muted',
    mix('var(--color-text) 62%', 'var(--color-surface)'),
    ['text', 'surface'],
  ],
  ['--color-danger-text', mix('var(--color-danger)', 'white 45%'), ['danger']],
  ['--color-danger-dark', mix('var(--color-danger)', 'black 15%'), ['danger']],
  [
    '--color-danger-muted',
    mix('var(--color-danger) 15%', 'var(--color-app-bg)'),
    ['danger', 'background'],
  ],
];

// Dark enough over any picture for the login card's edge to read against it.
const SCRIM = 'rgb(0 0 0 / 0.45)';

/** The variables `theme` asks for, in order; none if it asks for nothing. */
export function themeTokens({
  colors = {},
  corners,
  font,
  dialogDim,
  background,
}: Theme): [token: string, value: string][] {
  const set = Object.entries(colors) as [ThemeColor, string][];
  const tokens: [string, string][] = [
    ...set.map(([name, value]): [string, string] => [
      THEME_TOKENS[name],
      value,
    ]),
    ...DERIVED.filter(([, , from]) => from.some((c) => colors[c])).map(
      ([token, value]): [string, string] => [token, value],
    ),
  ];
  if (corners) {
    const [control, panel] = THEME_CORNERS[corners];
    tokens.push(
      ['--radius-control', `${control}px`],
      ['--radius-panel', `${panel}px`],
    );
  }
  if (font) tokens.push(['--font-ui', THEME_FONTS[font]]);
  if (!dialogDim) tokens.push(['--dialog-dim', 'transparent']);
  if (background)
    tokens.push([
      '--auth-backdrop',
      `linear-gradient(${SCRIM}, ${SCRIM}), url('/theme/${background}') center / cover`,
    ]);
  return tokens;
}
