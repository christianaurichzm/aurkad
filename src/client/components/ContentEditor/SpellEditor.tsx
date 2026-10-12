import React, { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import {
  fetchSpells,
  createSpell,
  updateSpell,
  deleteSpell,
} from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { SpritePreview } from '../common/SpritePreview';
import { spellSheet } from '../../io/assets';
import { SPELL_FRAME_MS } from '../../graphics/spellEffect';
import { editorStyles } from '../../theme';
import { useT } from '../../i18n';
import {
  useEntrySelection,
  type EditorGuardProps,
} from '../../hooks/useEntrySelection';
import type { Spell } from '../../../shared/types';

const { container, field, label, input, saveBtn, deleteBtn, ghostBtn } =
  editorStyles;

type SpellForm = {
  name: string;
  description: string;
  sprite: number;
  frames: number;
  mpCost: number;
  target: Spell['target'];
  damage: number;
  heal: number;
  cooldownMs: number;
  visualTarget: Spell['visualTarget'];
  icon: number | null;
};

const defaults: SpellForm = {
  name: '',
  description: '',
  sprite: 0,
  frames: 1,
  mpCost: 0,
  target: 'enemies',
  damage: 0,
  heal: 0,
  cooldownMs: 3000,
  visualTarget: 'self',
  icon: null,
};

export const SpellEditor: React.FC<EditorGuardProps> = (guard) => {
  const t = useT();
  const {
    formState: { isDirty },
    handleSubmit,
    register,
    reset,
    watch,
  } = useForm<SpellForm>({ defaultValues: defaults });

  const { selectedId, clear, open, startNew } = useEntrySelection(
    isDirty,
    guard,
    () => reset(defaults),
  );

  const loadOptions = useCallback(async () => {
    const data = await fetchSpells();
    return data.map((s) => ({
      value: String(s.id),
      label: `${s.id} - ${s.name}`,
    }));
  }, []);

  const handleSelect = async (id: string) => {
    if (!(await open(id))) return;
    const spells = await fetchSpells();
    const s = spells.find((x) => String(x.id) === id);
    if (s)
      reset({
        name: s.name,
        description: s.description,
        sprite: s.sprite,
        frames: s.frames ?? 1,
        mpCost: s.mpCost,
        // A spell with no target aims at enemies when it deals damage and heals
        // the caster otherwise.
        target: s.target ?? (s.damage > 0 ? 'enemies' : 'self'),
        damage: s.damage,
        heal: s.heal ?? 0,
        cooldownMs: s.cooldownMs ?? 0,
        visualTarget: s.visualTarget ?? 'self',
        icon: s.icon ?? null,
      });
  };

  const handleSave = async (data: SpellForm) => {
    const result = selectedId
      ? await updateSpell(Number(selectedId), data)
          .then(() => true)
          .catch(() => false)
      : !!(await createSpell(data).catch(() => null));
    chatResultMsg(!!result, t('spell.saved'), t('spell.saveError'));
    if (!result) return;
    clear();
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const ok = await deleteSpell(Number(selectedId))
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, t('spell.deleted'), t('spell.deleteError'));
    if (!ok) return;
    clear();
  };

  const name = watch('name');
  const target = watch('target');
  // What the hotbar shows (modules/magic/server.js): the icon, or a frame a
  // third into the effect.
  const icon = watch('icon');
  const sprite = watch('sprite');
  const frames = watch('frames') || 1;
  const iconTile = icon ?? sprite + Math.floor(frames / 3);

  return (
    <form style={container} onSubmit={handleSubmit(handleSave)}>
      <div style={field}>
        <label style={label}>{t('spell.spell')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadOptions}
              value={selectedId}
              onChange={(v) => void handleSelect(v)}
            />
          </div>
          {selectedId && (
            <button
              type="button"
              style={ghostBtn}
              onClick={() => void startNew()}
            >
              {t('editor.new')}
            </button>
          )}
        </div>
      </div>
      <div style={field}>
        <label style={label}>{t('editor.name')}</label>
        <input
          style={input}
          {...register('name')}
          placeholder={t('spell.namePlaceholder')}
        />
      </div>
      <div style={field}>
        <label style={label}>{t('editor.description')}</label>
        <input style={input} {...register('description')} placeholder="..." />
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'flex-end',
        }}
      >
        <div style={field}>
          <label style={label}>{t('editor.sprite')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('sprite', { valueAsNumber: true })}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('spell.frames')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            min={1}
            {...register('frames', { valueAsNumber: true })}
          />
        </div>
        <SpritePreview
          spriteId={watch('sprite')}
          sheet={spellSheet}
          tileSize={32}
          size={48}
          frames={frames}
          frameMs={SPELL_FRAME_MS}
        />
        <div style={field}>
          <label style={label} htmlFor="spell-icon">
            {t('spell.icon')}
          </label>
          <input
            id="spell-icon"
            style={{ ...input, width: 70 }}
            type="number"
            min={0}
            placeholder={t('spell.iconAuto')}
            title={t('spell.iconHint')}
            {...register('icon', {
              setValueAs: (v: unknown) =>
                v === '' || v === null ? null : Number(v),
            })}
          />
        </div>
        {Number.isFinite(iconTile) && (
          <SpritePreview
            spriteId={iconTile}
            sheet={spellSheet}
            tileSize={32}
            size={48}
          />
        )}
        <div style={field}>
          <label style={label}>{t('spell.mpCost')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('mpCost', { valueAsNumber: true })}
          />
        </div>
        {target === 'enemies' ? (
          <div style={field}>
            <label style={label}>{t('editor.damage')}</label>
            <input
              style={{ ...input, width: 70 }}
              type="number"
              {...register('damage', { valueAsNumber: true })}
            />
          </div>
        ) : (
          <div style={field}>
            <label style={label}>{t('spell.heal')}</label>
            <input
              style={{ ...input, width: 90 }}
              type="number"
              min={0}
              {...register('heal', { valueAsNumber: true })}
            />
          </div>
        )}
        <div style={field}>
          <label style={label}>{t('spell.cooldown')}</label>
          <input
            style={{ ...input, width: 80 }}
            type="number"
            min={0}
            {...register('cooldownMs', { valueAsNumber: true })}
          />
        </div>
      </div>
      <div style={field}>
        <label style={label}>{t('spell.target')}</label>
        <select style={input} {...register('target')}>
          <option value="enemies">{t('spell.targetEnemies')}</option>
          <option value="self">{t('spell.targetSelf')}</option>
          <option value="party">{t('spell.targetParty')}</option>
          <option value="guild">{t('spell.targetGuild')}</option>
        </select>
      </div>
      {target !== 'self' && (
        <div style={field}>
          <label style={label}>{t('spell.visualTarget')}</label>
          <select style={input} {...register('visualTarget')}>
            <option value="self">{t('spell.visualSelf')}</option>
            <option value="targets">{t('spell.visualTargets')}</option>
          </select>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={saveBtn} disabled={!name.trim()}>
          {selectedId ? t('common.save') : t('editor.create')}
        </button>
        {selectedId && (
          <button
            type="button"
            style={deleteBtn}
            onClick={() => void handleDelete()}
          >
            {t('common.delete')}
          </button>
        )}
      </div>
    </form>
  );
};
