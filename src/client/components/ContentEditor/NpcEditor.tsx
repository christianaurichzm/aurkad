import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { RuntimeNpc, NpcBehavior, Item } from '../../../shared/types';
import { drawSpriteGeneric } from '../../graphics/render';
import { updateNpc, createNpc, deleteNpc } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { ItemIcon } from '../Inventory/ItemIcon';
import { colors, radius } from '../../theme';

interface NpcEditorProps {
  npcs: RuntimeNpc[];
  items: Item[];
  loadNpcs: () => Promise<any>;
  loadItems: () => Promise<any>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

type NpcFormValues = {
  name: string;
  sprite: number;
  health: number;
  attack: number;
  behavior: NpcBehavior;
  exp: number;
  dropItemId: number;
  dropChance: number;
  dropQuantity: number;
};

const defaultValues: NpcFormValues = {
  name: '',
  sprite: 0,
  health: 1,
  attack: 1,
  behavior: 'neutral',
  exp: 0,
  dropItemId: 0,
  dropChance: 100,
  dropQuantity: 1,
};

const npcToFormValues = (npc: RuntimeNpc): NpcFormValues => {
  const drop = npc.itemsToDrop?.[0];

  return {
    name: npc.name,
    sprite: npc.sprite,
    health: npc.maxHealth ?? 1,
    attack: npc.attack ?? 1,
    behavior: npc.behavior,
    exp: npc.experienceValue ?? 0,
    dropItemId: drop?.itemId ?? 0,
    dropChance: drop ? Math.round(drop.chance * 100) : 100,
    dropQuantity: drop?.quantity ?? 1,
  };
};

export const NpcEditor: React.FC<NpcEditorProps> = ({
  npcs,
  items,
  loadNpcs,
  loadItems,
  refreshData,
  onDirtyChange,
  requestDiscard,
}) => {
  const [selectedId, setSelectedId] = useState('');
  const {
    control,
    formState: { isDirty },
    handleSubmit,
    register,
    reset: resetForm,
    watch,
  } = useForm<NpcFormValues>({ defaultValues });
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const sprite = watch('sprite');
  const dropItemId = watch('dropItemId');

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

  const drawPreview = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      drawSpriteGeneric(ctx, sprite, 0, 0, 0, 0, 64, 64);
    },
    [sprite],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPreview(ctx);
  }, [drawPreview]);

  const selectNpc = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
    const npc = npcs.find((n) => n.id === id);
    if (npc) {
      resetForm(npcToFormValues(npc));
    }
  };

  const saveNpc = async ({
    name,
    sprite,
    health,
    attack,
    behavior,
    exp,
    dropItemId,
    dropChance,
    dropQuantity,
  }: NpcFormValues) => {
    const data = {
      name,
      sprite,
      maxHealth: health,
      attack,
      behavior,
      experienceValue: exp,
      itemsToDrop: dropItemId
        ? [
            {
              itemId: dropItemId,
              chance: dropChance / 100,
              quantity: Math.max(1, Math.floor(dropQuantity)),
            },
          ]
        : [],
    };
    const result = selectedId
      ? await updateNpc(selectedId, data)
      : await createNpc(data);
    chatResultMsg(!!result, 'NPC saved!', 'Error saving NPC');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const removeNpc = async () => {
    if (!selectedId) return;
    await deleteNpc(selectedId);
    chatResultMsg(true, 'NPC deleted!', 'Error deleting NPC');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const behaviorOptions: { value: NpcBehavior; label: string }[] = [
    { value: 'neutral', label: 'Neutral' },
    { value: 'aggressive', label: 'Aggressive' },
    { value: 'hostile', label: 'Hostile' },
    { value: 'friendly', label: 'Friendly' },
    { value: 'shopkeeper', label: 'Shopkeeper' },
    { value: 'guard', label: 'Guard' },
  ];

  const dropItem = dropItemId ? items.find((i) => i.id === dropItemId) : null;

  return (
    <form style={container} onSubmit={handleSubmit(saveNpc)}>
      <div style={field}>
        <label style={label}>NPC</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadNpcs}
              value={selectedId}
              onChange={(id) => void selectNpc(id)}
            />
          </div>
          {selectedId && (
            <button type="button" style={resetBtn} onClick={() => void reset()}>
              New
            </button>
          )}
        </div>
      </div>

      <div style={cols}>
        <div style={leftCol}>
          <canvas
            ref={canvasRef}
            width={64}
            height={64}
            style={previewCanvas}
          />
          <div style={field}>
            <label style={label}>Sprite ID</label>
            <input
              style={input}
              type="number"
              {...register('sprite', { setValueAs: Number })}
            />
          </div>
        </div>

        <div style={rightCol}>
          <div style={field}>
            <label style={label}>Name</label>
            <input style={input} {...register('name')} placeholder="NPC name" />
          </div>
          <div style={field}>
            <label style={label}>Behavior</label>
            <Controller
              control={control}
              name="behavior"
              render={({ field }) => (
                <AsyncSelect<NpcBehavior>
                  loadOptions={async () => behaviorOptions}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div style={triRow}>
            <div style={field}>
              <label style={label}>HP</label>
              <input
                style={input}
                type="number"
                {...register('health', { setValueAs: Number })}
              />
            </div>
            <div style={field}>
              <label style={label}>ATK</label>
              <input
                style={input}
                type="number"
                {...register('attack', { setValueAs: Number })}
              />
            </div>
            <div style={field}>
              <label style={label}>EXP</label>
              <input
                style={input}
                type="number"
                {...register('exp', { setValueAs: Number })}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={dropSection}>
        <div style={dropRow}>
          <div style={{ flex: 1 }}>
            <label style={label}>Drop item</label>
            <Controller
              control={control}
              name="dropItemId"
              render={({ field }) => (
                <AsyncSelect<number>
                  loadOptions={loadItems}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          {dropItemId && (
            <div style={{ width: 80 }}>
              <label style={label}>Chance %</label>
              <input
                style={input}
                type="number"
                min={0}
                max={100}
                {...register('dropChance', {
                  setValueAs: (value) =>
                    Math.min(100, Math.max(0, Number(value))),
                })}
              />
            </div>
          )}
          {dropItemId && (
            <div style={{ width: 80 }}>
              <label style={label}>Quantity</label>
              <input
                style={input}
                type="number"
                min={1}
                {...register('dropQuantity', {
                  setValueAs: (value) => Math.max(1, Math.floor(Number(value))),
                })}
              />
            </div>
          )}
          {dropItem && <ItemIcon spriteId={dropItem.sprite} style={dropIcon} />}
        </div>
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? 'Save NPC' : 'Create NPC'}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={removeNpc}>
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

const cols: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: 14,
};

const leftCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'center',
};

const rightCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const triRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
};

const previewCanvas: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  background: colors.surfaceMuted,
};

const dropSection: React.CSSProperties = {
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
};

const dropRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 10,
};

const dropIcon: React.CSSProperties = {
  width: 36,
  height: 36,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  flexShrink: 0,
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
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  background: colors.surface,
};

const actions: React.CSSProperties = { display: 'flex', gap: 8 };

const saveBtn: React.CSSProperties = {
  flex: 1,
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '9px 16px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};

const deleteBtn: React.CSSProperties = {
  background: colors.danger,
  color: '#fff',
  border: 'none',
  padding: '9px 14px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};

const resetBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '7px 12px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
};
