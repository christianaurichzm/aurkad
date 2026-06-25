import React, { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  fetchSpells,
  createSpell,
  updateSpell,
  deleteSpell,
} from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { colors, radius } from '../../theme';

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
};

const defaults: SpellForm = {
  name: '',
  description: '',
  sprite: 0,
  mpCost: 0,
  damage: 0,
};

export const SpellEditor: React.FC<SpellEditorProps> = ({
  onDirtyChange,
  requestDiscard,
}) => {
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

  const loadOptions = async () => {
    const data = await fetchSpells();
    return data.map((s) => ({
      value: String(s.id),
      label: `${s.id} - ${s.name}`,
    }));
  };

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
      });
  };

  const handleSave = async (data: SpellForm) => {
    const result = selectedId
      ? (await updateSpell(Number(selectedId), data), true)
      : !!(await createSpell(data));
    chatResultMsg(!!result, 'Spell saved!', 'Error saving spell');
    reset(defaults);
    setSelectedId('');
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    await deleteSpell(Number(selectedId));
    chatResultMsg(true, 'Spell deleted!', '');
    reset(defaults);
    setSelectedId('');
  };

  const name = watch('name');

  return (
    <form style={container} onSubmit={handleSubmit(handleSave)}>
      <div style={field}>
        <label style={label}>Spell</label>
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
              New
            </button>
          )}
        </div>
      </div>
      <div style={field}>
        <label style={label}>Name</label>
        <input style={input} {...register('name')} placeholder="Fireball" />
      </div>
      <div style={field}>
        <label style={label}>Description</label>
        <input style={input} {...register('description')} placeholder="..." />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={field}>
          <label style={label}>Sprite</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('sprite', { valueAsNumber: true })}
          />
        </div>
        <div style={field}>
          <label style={label}>MP Cost</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('mpCost', { valueAsNumber: true })}
          />
        </div>
        <div style={field}>
          <label style={label}>Damage</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('damage', { valueAsNumber: true })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={saveBtn} disabled={!name.trim()}>
          {selectedId ? 'Save' : 'Create'}
        </button>
        {selectedId && (
          <button
            type="button"
            style={deleteBtn}
            onClick={() => void handleDelete()}
          >
            Delete
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
