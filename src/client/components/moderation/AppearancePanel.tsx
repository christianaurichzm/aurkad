import React, { useEffect, useMemo, useState } from 'react';
import {
  fetchTheme,
  friendlyHttpError,
  removeThemeImage,
  saveTheme,
  uploadThemeImage,
} from '../../io/network';
import {
  THEME_ART,
  THEME_CORNERS,
  THEME_FONTS,
  THEME_IMAGES,
  THEME_LAYOUTS,
  THEME_TOKENS,
  themeTokens,
  type Theme,
  type ThemeColor,
  type ThemeImage,
} from '../../../shared/theme';
import { useT, type TranslationKey } from '../../i18n';
import { useGameBrand } from '../common/AuthLayout';
import { Icon, type IconName } from '../common/Icon';
import { ENGINE_MARK } from '../../../shared/constants';

/**
 * How the game looks without writing CSS: colours, corners, a font, the
 * menu's place, a logo and a login picture.
 *
 * The preview is the game's own markup under the variables a save would
 * write, starting from the engine's values. A variable the handwritten
 * theme.css sets wins in the game, so the preview leaves it to the page and
 * its control is locked.
 */

const COLORS: Record<ThemeColor, TranslationKey> = {
  primary: 'appearance.color.primary',
  accent: 'appearance.color.accent',
  background: 'appearance.color.background',
  surface: 'appearance.color.surface',
  text: 'appearance.color.text',
  danger: 'appearance.color.danger',
};
const CORNERS: Record<keyof typeof THEME_CORNERS, TranslationKey> = {
  square: 'appearance.corners.square',
  soft: 'appearance.corners.soft',
  round: 'appearance.corners.round',
};
const FONTS: Record<keyof typeof THEME_FONTS, TranslationKey> = {
  system: 'appearance.font.system',
  serif: 'appearance.font.serif',
  mono: 'appearance.font.mono',
};
const LAYOUTS: Record<Theme['layout'], TranslationKey> = {
  right: 'appearance.layout.right',
  left: 'appearance.layout.left',
  bottom: 'appearance.layout.bottom',
  overlay: 'appearance.layout.overlay',
};
const ART: Record<Theme['art'], TranslationKey> = {
  pixel: 'appearance.art.pixel',
  smooth: 'appearance.art.smooth',
};
const IMAGES: Record<ThemeImage, TranslationKey> = {
  logo: 'appearance.image.logo',
  background: 'appearance.image.background',
};

// The side column's first tiles, as the game draws them.
const SAMPLE_ACTIONS: [icon: IconName, label: TranslationKey][] = [
  ['bag', 'actions.inventory'],
  ['stats', 'actions.attributes'],
  ['players', 'actions.onlinePlayers'],
];
const SAMPLE_HP = { now: 72, max: 100 };
const SAMPLE_MP = { now: 27, max: 60 };
const share = ({ now, max }: { now: number; max: number }) =>
  `${(now / max) * 100}%`;
// The login form's own field and button sizes (pages/Login.tsx).
const sampleInput: React.CSSProperties = {
  width: '100%',
  padding: 12,
  marginBottom: 12,
};
const sampleSubmit: React.CSSProperties = {
  width: '100%',
  padding: 12,
  fontWeight: 700,
};

type Look = Pick<Theme, 'colors' | 'corners' | 'font'>;

// Starting points, each leaving the layout and pictures as they are.
const PRESETS: [name: TranslationKey, look: Look][] = [
  ['appearance.preset.engine', { colors: {} }],
  [
    'appearance.preset.parchment',
    {
      colors: {
        primary: '#8a6a1c',
        accent: '#d9b441',
        background: '#1c130c',
        surface: '#3a2a1d',
        text: '#f3e6c8',
        danger: '#b5412e',
      },
      corners: 'soft',
      font: 'serif',
    },
  ],
  [
    'appearance.preset.midnight',
    {
      colors: {
        primary: '#5b5bd6',
        accent: '#9e8cfc',
        background: '#0d0b1a',
        surface: '#1b1830',
        text: '#e6e4f5',
        danger: '#d6455d',
      },
      corners: 'round',
    },
  ],
  [
    'appearance.preset.forest',
    {
      colors: {
        primary: '#3f8f4f',
        accent: '#c9d44a',
        background: '#0d1510',
        surface: '#1b2a20',
        text: '#e4efe2',
        danger: '#c8503c',
      },
      corners: 'soft',
    },
  ],
  [
    'appearance.preset.terminal',
    {
      colors: {
        primary: '#1f7a45',
        accent: '#4ade80',
        background: '#050805',
        surface: '#0e140e',
        text: '#c8f7d0',
        danger: '#e5484d',
      },
      corners: 'square',
      font: 'mono',
    },
  ],
];

// The server's limit, checked here first so the message can say why.
const IMAGE_LIMIT = 2 * 1024 * 1024;

const HEX = /^#[0-9a-f]{6}$/i;

/** The variables styles.css declares, whatever theme loads over it. */
function engineVariables(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const sheet of document.styleSheets) {
    if (!sheet.href || new URL(sheet.href).pathname !== '/styles.css') continue;
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || rule.selectorText !== ':root')
        continue;
      for (const name of rule.style)
        if (name.startsWith('--'))
          out[name] = rule.style.getPropertyValue(name).trim();
    }
  }
  return out;
}

/** What the page's stylesheets, the game's theme.css included, give `token`. */
const pageColor = (token: string) => {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return HEX.test(value) ? value : '#000000';
};

/** This page is themed by what was saved when it loaded; take the new one. */
const reloadTheme = () =>
  document
    .querySelector<HTMLLinkElement>('link[href*="/theme/theme.css"]')
    ?.setAttribute('href', `/theme/theme.css?${Date.now()}`);

const choicesOf = ({ logo: _, background: __, ...choices }: Theme) =>
  JSON.stringify(choices);

export const AppearancePanel: React.FC = () => {
  const t = useT();
  const brand = useGameBrand();
  const engine = useMemo(engineVariables, []);
  const [saved, setSaved] = useState<Theme | null>(null);
  const [draft, setDraft] = useState<Theme | null>(null);
  const [handwritten, setHandwritten] = useState(false);
  const [cssVariables, setCssVariables] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    fetchTheme()
      .then((found) => {
        if (!found) return;
        setSaved(found.theme);
        setDraft(found.theme);
        setHandwritten(found.handwritten);
        setCssVariables(new Set(found.cssVariables));
      })
      .catch((e: unknown) => setError(friendlyHttpError(e)));
  }, []);

  if (!saved || !draft)
    return (
      <div className="appearance-note">{error || t('common.loading')}</div>
    );

  const change = (next: Partial<Theme>) => {
    setDraft({ ...draft, ...next });
    setNote('');
  };
  const dirty = choicesOf(draft) !== choicesOf(saved);

  /** Every request is the same shape: try it, show what the server said. */
  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setNote('');
    try {
      await step();
      reloadTheme();
    } catch (e: unknown) {
      setError(friendlyHttpError(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      const stored = await saveTheme(draft);
      if (!stored) return;
      setSaved(stored);
      setDraft(stored);
      setNote(t('appearance.saved'));
    });

  // A picture saves as it arrives, so it changes in the saved theme and the
  // draft alike while the rest of the draft stays unsaved.
  const pictureIs = (slot: ThemeImage, stored: Theme | null) => {
    if (!stored) return;
    setSaved({ ...saved, [slot]: stored[slot] });
    setDraft({ ...draft, [slot]: stored[slot] });
  };
  const upload = (slot: ThemeImage, file: File | undefined) => {
    if (!file) return;
    if (file.size > IMAGE_LIMIT) return setError(t('appearance.tooLarge'));
    void run(async () => pictureIs(slot, await uploadThemeImage(slot, file)));
  };
  const remove = (slot: ThemeImage) =>
    run(async () => pictureIs(slot, await removeThemeImage(slot)));

  const colors = draft.colors ?? {};
  const setColor = (color: ThemeColor, value: string | undefined) => {
    const { [color]: _, ...rest } = colors;
    change({ colors: value ? { ...rest, [color]: value } : rest });
  };
  const engineColor = (color: ThemeColor) => {
    const value = engine[THEME_TOKENS[color]] ?? '';
    return HEX.test(value) ? value : '#000000';
  };

  const fromCss = (...tokens: string[]) =>
    tokens.every((token) => cssVariables.has(token));

  const previewStyle = Object.fromEntries(
    [...Object.entries(engine), ...themeTokens(draft)].filter(
      ([token]) => !cssVariables.has(token),
    ),
  ) as React.CSSProperties;
  const logo = draft.logo ? `/theme/${draft.logo}` : brand?.logo;

  return (
    <div className="appearance">
      <form
        className="appearance-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {handwritten && (
          <p className="appearance-note" data-tone="warning">
            {t('appearance.handwritten')}
          </p>
        )}

        <fieldset>
          <legend>{t('appearance.presets')}</legend>
          <div className="chips">
            {PRESETS.map(([name, look]) => (
              <button
                key={name}
                type="button"
                className="chip"
                onClick={() =>
                  change({
                    colors: look.colors,
                    corners: look.corners,
                    font: look.font,
                  })
                }
              >
                <span className="appearance-swatches" aria-hidden="true">
                  {(
                    ['background', 'surface', 'primary', 'accent'] as const
                  ).map((color) => (
                    <i
                      key={color}
                      style={{
                        background: look.colors?.[color] ?? engineColor(color),
                      }}
                    />
                  ))}
                </span>
                {t(name)}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('appearance.colors')}</legend>
          {(Object.keys(COLORS) as ThemeColor[]).map((color) => (
            <div key={color} className="appearance-row">
              <label>
                <input
                  type="color"
                  disabled={fromCss(THEME_TOKENS[color])}
                  value={
                    fromCss(THEME_TOKENS[color])
                      ? pageColor(THEME_TOKENS[color])
                      : (colors[color] ?? engineColor(color))
                  }
                  onChange={(e) => setColor(color, e.target.value)}
                />
                {t(COLORS[color])}
              </label>
              {fromCss(THEME_TOKENS[color]) ? (
                <small>{t('appearance.setInCss')}</small>
              ) : colors[color] ? (
                <button
                  type="button"
                  className="link-button"
                  aria-label={t('appearance.reset', { name: t(COLORS[color]) })}
                  onClick={() => setColor(color, undefined)}
                >
                  {colors[color]} <span aria-hidden="true">×</span>
                </button>
              ) : (
                <small>{t('appearance.engineDefault')}</small>
              )}
            </div>
          ))}
        </fieldset>

        <fieldset>
          <div className="appearance-row">
            <label htmlFor="appearance-corners">
              {t('appearance.corners')}
            </label>
            <select
              id="appearance-corners"
              disabled={fromCss('--radius-control', '--radius-panel')}
              value={
                fromCss('--radius-control', '--radius-panel')
                  ? ''
                  : (draft.corners ?? '')
              }
              onChange={(e) =>
                change({
                  corners: (e.target.value || undefined) as Theme['corners'],
                })
              }
            >
              <option value="">
                {t(
                  fromCss('--radius-control', '--radius-panel')
                    ? 'appearance.setInCss'
                    : 'appearance.engineDefault',
                )}
              </option>
              {(Object.keys(CORNERS) as (keyof typeof CORNERS)[]).map((c) => (
                <option key={c} value={c}>
                  {t(CORNERS[c])}
                </option>
              ))}
            </select>
          </div>
          <div className="appearance-row">
            <label htmlFor="appearance-font">{t('appearance.font')}</label>
            <select
              id="appearance-font"
              disabled={fromCss('--font-ui')}
              value={fromCss('--font-ui') ? '' : (draft.font ?? '')}
              onChange={(e) =>
                change({ font: (e.target.value || undefined) as Theme['font'] })
              }
            >
              <option value="">
                {t(
                  fromCss('--font-ui')
                    ? 'appearance.setInCss'
                    : 'appearance.engineDefault',
                )}
              </option>
              {(Object.keys(FONTS) as (keyof typeof FONTS)[]).map((f) => (
                <option key={f} value={f}>
                  {t(FONTS[f])}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend>{t('appearance.layout')}</legend>
          {THEME_LAYOUTS.map((layout) => (
            <label key={layout} className="appearance-check">
              <input
                type="radio"
                name="appearance-layout"
                checked={draft.layout === layout}
                onChange={() => change({ layout })}
              />
              {t(LAYOUTS[layout])}
            </label>
          ))}
          {draft.layout === 'bottom' && (
            <p className="appearance-note">{t('appearance.layoutCost')}</p>
          )}
          {draft.layout === 'overlay' && (
            <p className="appearance-note">{t('appearance.layoutCrop')}</p>
          )}
          <label className="appearance-check">
            <input
              type="checkbox"
              checked={draft.dialogDim}
              onChange={(e) => change({ dialogDim: e.target.checked })}
            />
            {t('appearance.dialogDim')}
          </label>
        </fieldset>

        <fieldset>
          <legend>{t('appearance.art')}</legend>
          {THEME_ART.map((art) => (
            <label key={art} className="appearance-check">
              <input
                type="radio"
                name="appearance-art"
                checked={draft.art === art}
                onChange={() => change({ art })}
              />
              {t(ART[art])}
            </label>
          ))}
        </fieldset>

        <fieldset disabled={busy}>
          {THEME_IMAGES.map((slot) => (
            <div key={slot} className="appearance-row">
              <label>
                {t(IMAGES[slot])}
                <input
                  disabled={slot === 'background' && fromCss('--auth-backdrop')}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={t('appearance.upload', { name: t(IMAGES[slot]) })}
                  onChange={(e) => {
                    upload(slot, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {slot === 'background' && fromCss('--auth-backdrop') && (
                <small>{t('appearance.setInCss')}</small>
              )}
              {draft[slot] && (
                <button
                  type="button"
                  className="link-button"
                  aria-label={`${t('appearance.remove')}: ${t(IMAGES[slot])}`}
                  onClick={() => void remove(slot)}
                >
                  {t('appearance.remove')}
                </button>
              )}
            </div>
          ))}
          <p className="appearance-note">{t('appearance.imageHint')}</p>
        </fieldset>

        <div className="appearance-savebar">
          <div className="appearance-actions">
            <button
              type="submit"
              className="button-primary"
              disabled={busy || !dirty}
            >
              {t('appearance.save')}
            </button>
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => setDraft(saved)}
            >
              {t('appearance.discard')}
            </button>
          </div>
          {error && (
            <p className="appearance-note" role="alert" data-tone="danger">
              {error}
            </p>
          )}
          {note && (
            <p className="appearance-note" role="status">
              {note}
            </p>
          )}
        </div>
      </form>

      {/* The game's own markup and ids, which a theme.css styles: the game
          is not mounted on this page, so none of them is taken. */}
      <section
        className="appearance-preview"
        aria-label={t('appearance.preview')}
        style={previewStyle}
        inert
      >
        <p className="appearance-caption">{t('appearance.sample.login')}</p>
        <div className="appearance-login">
          <div className="auth-layout">
            <div className="auth-card">
              <div className="auth-heading">
                <div
                  className="engine-brand"
                  data-engine-mark={logo === ENGINE_MARK || undefined}
                >
                  {logo && <img src={logo} alt="" />}
                  <span>{brand?.name}</span>
                </div>
                <h1>{t('auth.login')}</h1>
              </div>
              <div className="auth-form">
                <input placeholder={t('auth.username')} style={sampleInput} />
                <input placeholder={t('auth.password')} style={sampleInput} />
                <button
                  type="submit"
                  className="button-primary"
                  style={sampleSubmit}
                >
                  {t('auth.login')}
                </button>
              </div>
            </div>
          </div>
        </div>

        <p className="appearance-caption">{t('appearance.sample.game')}</p>
        <div className="appearance-game" data-layout={draft.layout}>
          <div className="appearance-world">
            <div id="map-name">{t('appearance.sample.world')}</div>
            <div className="editor-window game-window">
              <div className="window-titlebar">
                <h2>{t('appearance.sample.quest')}</h2>
              </div>
              <div className="window-content">
                <p>{t('appearance.sample.progress')}</p>
                <div className="appearance-actions">
                  <button type="button" className="button-primary">
                    {t('appearance.sample.accept')}
                  </button>
                  <button type="button" className="button-danger">
                    {t('appearance.sample.abandon')}
                  </button>
                </div>
              </div>
            </div>
          </div>
          <div className="appearance-side">
            <div id="hud" className="panel">
              <div id="hud-portrait" data-sprite={0} />
              <div className="hud-stats">
                <div id="hud-who">
                  <span id="hud-name">{t('appearance.sample.player')}</span>
                  <span id="hud-level">{t('hud.level', { level: 7 })}</span>
                </div>
                <div id="hud-row">
                  <span id="hud-hp-label">{t('hud.hp')}</span>
                  <div id="health-bar-container">
                    <div id="health-bar" style={{ width: share(SAMPLE_HP) }} />
                  </div>
                  <span id="hud-hp-values">
                    {SAMPLE_HP.now}/{SAMPLE_HP.max}
                  </span>
                </div>
                <div className="hud-resource-row">
                  <span className="hud-resource-label">{t('hud.mp')}</span>
                  <div className="mana-track">
                    <div
                      className="mana-fill"
                      style={{ width: share(SAMPLE_MP) }}
                    />
                  </div>
                  <span className="hud-resource-values">
                    {SAMPLE_MP.now}/{SAMPLE_MP.max}
                  </span>
                </div>
              </div>
            </div>
            <div id="actionPanel" className="panel">
              <div className="action-grid">
                {SAMPLE_ACTIONS.map(([icon, label]) => (
                  <button key={icon} type="button" className="action-button">
                    <Icon name={icon} />
                    <span className="action-label">{t(label)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
