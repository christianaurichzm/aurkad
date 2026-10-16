import React, { useState } from 'react';
import { friendlyHttpError, uploadSheet } from '../../io/network';
import {
  SHEETS,
  SPRITE_LAYOUTS,
  type SpriteLayoutName,
} from '../../../shared/mappings';
import { useT, type TranslationKey } from '../../i18n';

type Sheet = (typeof SHEETS)[number];

const NAMES: Record<Sheet, TranslationKey> = {
  tiles: 'art.sheet.tiles',
  sprites: 'art.sheet.sprites',
  items: 'art.sheet.items',
  spells: 'art.sheet.spells',
  arrows: 'art.sheet.arrows',
  attackeffect: 'art.sheet.attackeffect',
};
const GRIDS: Record<Sheet, TranslationKey> = {
  tiles: 'art.grid.tiles',
  sprites: 'art.grid.sprites',
  items: 'art.grid.items',
  spells: 'art.grid.spells',
  arrows: 'art.grid.arrows',
  attackeffect: 'art.grid.attackeffect',
};
const LAYOUTS: Record<SpriteLayoutName, TranslationKey> = {
  aurkad: 'art.layout.aurkad',
  'three-48': 'art.layout.three-48',
  'three-32': 'art.layout.three-32',
};

// The server's limit, checked here first so the message can say why.
const SHEET_LIMIT = 16 * 1024 * 1024;

/**
 * The game's six image sheets, each downloaded and replaced whole without
 * touching a file. Characters may use RPG Maker's three-frame layout.
 */
export const ArtPanel: React.FC = () => {
  const t = useT();
  const [layout, setLayout] = useState<SpriteLayoutName | ''>('');
  // Bumped by each upload, so the thumbnails ask for the sheet again.
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const upload = async (sheet: Sheet, file: File | undefined) => {
    if (!file) return;
    setError('');
    setNote('');
    if (file.size > SHEET_LIMIT) return setError(t('art.tooLarge'));
    setBusy(true);
    try {
      await uploadSheet(
        sheet,
        file,
        (sheet === 'sprites' && layout) || undefined,
      );
      setVersion((v) => v + 1);
      setNote(t('art.saved'));
    } catch (e: unknown) {
      setError(friendlyHttpError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <fieldset className="art" disabled={busy}>
      <p className="appearance-note">{t('art.hint')}</p>
      {SHEETS.map((sheet) => (
        <div key={sheet} className="art-sheet">
          <img src={`/assets/${sheet}.png?v=${version}`} alt="" />
          <div className="art-sheet-body">
            <strong>{t(NAMES[sheet])}</strong>
            <small className="appearance-note">{t(GRIDS[sheet])}</small>
            {sheet === 'sprites' && (
              <label className="art-field">
                {t('art.layout')}
                <select
                  value={layout}
                  onChange={(e) =>
                    setLayout(e.target.value as SpriteLayoutName | '')
                  }
                >
                  <option value="">{t('art.layout.keep')}</option>
                  {(Object.keys(SPRITE_LAYOUTS) as SpriteLayoutName[]).map(
                    (name) => (
                      <option key={name} value={name}>
                        {t(LAYOUTS[name])}
                      </option>
                    ),
                  )}
                </select>
              </label>
            )}
            <div className="art-actions">
              <a
                className="art-action"
                href={`/assets/${sheet}.png`}
                download={`${sheet}.png`}
              >
                {t('art.download')}
              </a>
              <label className="art-action">
                {t('art.replace')}
                <input
                  type="file"
                  accept="image/png"
                  aria-label={t('art.replaceLabel', { name: t(NAMES[sheet]) })}
                  onChange={(e) => {
                    void upload(sheet, e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      ))}
      {error && (
        <p className="appearance-note" data-tone="danger" role="alert">
          {error}
        </p>
      )}
      {note && (
        <p className="appearance-note" role="status">
          {note}
        </p>
      )}
    </fieldset>
  );
};
