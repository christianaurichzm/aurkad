import React, { useCallback, useEffect, useState } from 'react';
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
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

interface SpellEditorProps {
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

type SpellForm = {
  name: string;
  description: string;
  sprite: number;
  mpCost: number;
  damage: number;
  cooldownMs: number;
  visualTarget: 'self' | 'targets';
};

const defaults: SpellForm = {
  name: '',
  description: '',
  sprite: 0,
  mpCost: 0,
  damage: 0,
  cooldownMs: 3000,
  visualTarget: 'self',
};

export const SpellEditor: React.FC<SpellEditorProps> = ({
  onDirtyChange,
  requestDiscard,
}) => {
  const t = useT();
  const [selectedId, setSelectedId] = useState('');
  const {
    formState: { isDirty },
    handleSubmit,
    register,
    reset,
    watch,
  } = useForm<SpellForm>({ defaultValues: defaults });

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const loadOptions = useCallback(async () => {
    const data = await fetchSpells();
    return data.map((s) => ({
      value: String(s.id),
      label: `${s.id} - ${s.name}`,
    }));
  }, []);

  const handleSelect = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
    const spells = await fetchSpells();
    const s = spells.find((x) => String(x.id) === id);
    if (s)
      reset({
        name: s.name,
        description: s.description,
        sprite: s.sprite,
        mpCost: s.mpCost,
        damage: s.damage,
        cooldownMs: s.cooldownMs ?? 0,
        visualTarget: s.visualTarget ?? 'self',
      });
  };

  const handleSave = async (data: SpellForm) => {
    const result = selectedId
      ? await updateSpell(Number(selectedId), data)
          .then(() => true)
          .catch(() => false)
      : !!(await createSpell(data).catch(() => null));
    chatResultMsg(!!result, t('spell.saved'), t('spell.saveError'));
    reset(defaults);
    setSelectedId('');
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const ok = await deleteSpell(Number(selectedId))
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, t('spell.deleted'), t('spell.deleteError'));
    reset(defaults);
    setSelectedId('');
  };

  const name = watch('name');

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
              onClick={() => {
                reset(defaults);
                setSelectedId('');
              }}
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={field}>
          <label style={label}>{t('editor.sprite')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('sprite', { valueAsNumber: true })}
          />
        </div>
        <SpritePreview
          spriteId={watch('sprite')}
          sheet={spellSheet}
          tileSize={32}
          size={48}
        />
        <div style={field}>
          <label style={label}>{t('spell.mpCost')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('mpCost', { valueAsNumber: true })}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('editor.damage')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('damage', { valueAsNumber: true })}
          />
        </div>
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
        <label style={label}>{t('spell.visualTarget')}</label>
        <select style={input} {...register('visualTarget')}>
          <option value="self">{t('spell.visualSelf')}</option>
          <option value="targets">{t('spell.visualTargets')}</option>
        </select>
      </div>
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

const container: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};
const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};
const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
};
const input: React.CSSProperties = {
  padding: '7px 9px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 14,
  background: colors.surface,
  width: '100%',
  boxSizing: 'border-box',
};
const saveBtn: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '10px 16px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
  flex: 1,
};
const deleteBtn: React.CSSProperties = {
  background: colors.danger,
  color: '#fff',
  border: 'none',
  padding: '10px 16px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};
const ghostBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '7px 12px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
};
