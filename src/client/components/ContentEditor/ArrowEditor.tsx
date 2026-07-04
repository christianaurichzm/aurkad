import React, { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  fetchArrows,
  createArrow,
  updateArrow,
  deleteArrow,
} from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { SpritePreview } from '../common/SpritePreview';
import { arrowSheet } from '../../io/assets';
import { colors, radius } from '../../theme';

interface ArrowEditorProps {
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

type ArrowForm = {
  name: string;
  description: string;
  sprite: number;
  damage: number;
  rangeTiles: number;
  tileSpeed: number;
};

const defaults: ArrowForm = {
  name: '',
  description: '',
  sprite: 4,
  damage: 0,
  rangeTiles: 6,
  tileSpeed: 8,
};

export const ArrowEditor: React.FC<ArrowEditorProps> = ({
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
  } = useForm<ArrowForm>({ defaultValues: defaults });

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const loadOptions = useCallback(async () => {
    const data = await fetchArrows();
    return data.map((a) => ({
      value: String(a.id),
      label: `${a.id} - ${a.name}`,
    }));
  }, []);

  const handleSelect = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
    const arrows = await fetchArrows();
    const a = arrows.find((x) => String(x.id) === id);
    if (a)
      reset({
        name: a.name,
        description: a.description,
        sprite: a.sprite,
        damage: a.damage,
        rangeTiles: a.rangeTiles ?? 6,
        tileSpeed: a.tileSpeed ?? 8,
      });
  };

  const handleSave = async (data: ArrowForm) => {
    const payload = {
      name: data.name,
      description: data.description,
      sprite: data.sprite,
      damage: data.damage,
      rangeTiles: data.rangeTiles,
      tileSpeed: data.tileSpeed,
    };
    const result = selectedId
      ? await updateArrow(Number(selectedId), payload)
          .then(() => true)
          .catch(() => false)
      : !!(await createArrow(payload).catch(() => null));
    chatResultMsg(!!result, 'Arrow saved!', 'Error saving arrow');
    reset(defaults);
    setSelectedId('');
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const ok = await deleteArrow(Number(selectedId))
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, 'Arrow deleted!', 'Error deleting arrow');
    reset(defaults);
    setSelectedId('');
  };

  const name = watch('name');

  return (
    <form style={container} onSubmit={handleSubmit(handleSave)}>
      <div style={field}>
        <label style={label}>Arrow</label>
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
        <input style={input} {...register('name')} placeholder="Iron Arrow" />
      </div>
      <div style={field}>
        <label style={label}>Description</label>
        <input style={input} {...register('description')} placeholder="..." />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={field}>
          <label style={label}>Sprite</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('sprite', { valueAsNumber: true })}
          />
        </div>
        <SpritePreview
          spriteId={watch('sprite')}
          sheet={arrowSheet}
          tileSize={32}
          size={48}
        />
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
        <div style={field}>
          <label style={label}>Range (tiles)</label>
          <input
            style={{ ...input, width: 90 }}
            type="number"
            {...register('rangeTiles', { valueAsNumber: true })}
          />
        </div>
        <div style={field}>
          <label style={label}>Speed (tiles/s)</label>
          <input
            style={{ ...input, width: 90 }}
            type="number"
            step="0.5"
            min="1"
            max="30"
            {...register('tileSpeed', { valueAsNumber: true })}
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
