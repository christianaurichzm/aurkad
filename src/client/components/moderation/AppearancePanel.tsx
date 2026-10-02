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

/**
 * How the game looks, chosen without writing CSS: colours, corners, a font,
 * where the menu sits, a logo and a picture behind the login.
 *
 * The preview is the game's own stylesheet under the variables the server
 * would write for the draft, so what it shows is what a save produces. It
 * starts from the engine's values and not from the page's: this page is
 * themed by the last save, and a colour cleared in the draft has to go back
 * to the engine's, not to the one still loaded.
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

  const previewStyle = {
    ...engine,
    ...Object.fromEntries(themeTokens(draft)),
  } as React.CSSProperties;
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
                  value={colors[color] ?? engineColor(color)}
                  onChange={(e) => setColor(color, e.target.value)}
                />
                {t(COLORS[color])}
              </label>
              {colors[color] ? (
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
              value={draft.corners ?? ''}
              onChange={(e) =>
                change({
                  corners: (e.target.value || undefined) as Theme['corners'],
                })
              }
            >
              <option value="">{t('appearance.engineDefault')}</option>
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
              value={draft.font ?? ''}
              onChange={(e) =>
                change({ font: (e.target.value || undefined) as Theme['font'] })
              }
            >
              <option value="">{t('appearance.engineDefault')}</option>
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
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label={t('appearance.upload', { name: t(IMAGES[slot]) })}
                  onChange={(e) => {
                    upload(slot, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
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
      </form>

      <section
        className="appearance-preview"
        aria-label={t('appearance.preview')}
        style={previewStyle}
        inert
      >
        <div className="appearance-login">
          <div className="auth-layout">
            <div className="auth-card">
              <div className="engine-brand">
                {logo && <img src={logo} alt="" />}
                <span>{brand?.name}</span>
              </div>
              <button type="button" className="button-primary">
                {t('appearance.sample.signIn')}
              </button>
            </div>
          </div>
        </div>
        <div className="appearance-game" data-layout={draft.layout}>
          <div className="appearance-world">{t('appearance.sample.world')}</div>
          <div className="panel">
            <h3 className="window-heading">{t('appearance.sample.player')}</h3>
            <div className="appearance-bar" />
            <ul className="list">
              <li className="list-row">
                <span className="list-row-text">
                  {t('appearance.sample.quest')}
                  <small>{t('appearance.sample.progress')}</small>
                </span>
              </li>
            </ul>
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
      </section>
    </div>
  );
};
