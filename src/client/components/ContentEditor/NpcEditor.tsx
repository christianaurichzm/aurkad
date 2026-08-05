import React, { useState, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  RuntimeNpc,
  NpcBehavior,
  Item,
  NpcItemDrop,
} from '../../../shared/types';
import { updateNpc, createNpc, deleteNpc } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { ItemIcon } from '../Inventory/ItemIcon';
import { SpritePreview } from '../common/SpritePreview';
import { ScriptBehaviorFields } from './ScriptBehaviorFields';
import type { ScriptParams } from '../../../shared/scriptParams';
import { colors, radius } from '../../theme';

interface NpcEditorProps {
  npcs: RuntimeNpc[];
  items: Item[];
  loadNpcs: () => Promise<any>;
  loadItems: () => Promise<any>;
  loadLootTables: () => Promise<{ value: string; label: string }[]>;
  loadDialogs: () => Promise<{ value: string; label: string }[]>;
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
  scriptId: string;
  scriptParams: ScriptParams;
  lootTableId: string;
  dialogId: string;
};

const defaultValues: NpcFormValues = {
  name: '',
  sprite: 0,
  health: 1,
  attack: 1,
  behavior: 'neutral',
  exp: 0,
  scriptId: '',
  scriptParams: {},
  lootTableId: '',
  dialogId: '',
};

const npcToFormValues = (npc: RuntimeNpc): NpcFormValues => ({
  name: npc.name,
  sprite: npc.sprite,
  health: npc.maxHealth ?? 1,
  attack: npc.attack ?? 1,
  behavior: npc.behavior,
  exp: npc.experienceValue ?? 0,
  scriptId: npc.scriptId ?? '',
  scriptParams: npc.scriptParams ?? {},
  lootTableId: npc.lootTableId ?? '',
  dialogId: npc.dialogId ?? '',
});

const npcToDrops = (npc: RuntimeNpc): NpcItemDrop[] =>
  (npc.itemsToDrop ?? []).map((d) => ({ ...d }));

const dropsEqual = (a: NpcItemDrop[], b: NpcItemDrop[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

export const NpcEditor: React.FC<NpcEditorProps> = ({
  npcs,
  items,
  loadNpcs,
  loadItems,
  loadLootTables,
  loadDialogs,
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
    setValue,
    watch,
  } = useForm<NpcFormValues>({ defaultValues });
  const sprite = watch('sprite');
  const scriptId = watch('scriptId');
  const scriptParams = watch('scriptParams');

  const [drops, setDrops] = useState<NpcItemDrop[]>([]);
  const [dropsBaseline, setDropsBaseline] = useState<NpcItemDrop[]>([]);
  const [addItemId, setAddItemId] = useState<number>(0);
  const [addChance, setAddChance] = useState<number>(100);
  const [addQty, setAddQty] = useState<number>(1);

  const dropsDirty = !dropsEqual(drops, dropsBaseline);

  useEffect(() => {
    onDirtyChange(isDirty || dropsDirty);
  }, [isDirty, dropsDirty, onDirtyChange]);

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
    setDrops([]);
    setDropsBaseline([]);
    setAddItemId(0);
    setAddChance(100);
    setAddQty(1);
  };

  const selectNpc = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
    const npc = npcs.find((n) => n.id === id);
    if (npc) {
      resetForm(npcToFormValues(npc));
      const initial = npcToDrops(npc);
      setDrops(initial);
      setDropsBaseline(initial);
    }
    setAddItemId(0);
    setAddChance(100);
    setAddQty(1);
  };

  const addDrop = () => {
    if (!addItemId) return;
    setDrops((prev) => [
      ...prev,
      {
        itemId: addItemId,
        chance: Math.min(1, Math.max(0, addChance / 100)),
        quantity: Math.max(1, Math.floor(addQty)),
      },
    ]);
    setAddItemId(0);
    setAddChance(100);
    setAddQty(1);
  };

  const removeDrop = (index: number) => {
    setDrops((prev) => prev.filter((_, i) => i !== index));
  };

  const saveNpc = async ({
    name,
    sprite,
    health,
    attack,
    behavior,
    exp,
    scriptId,
    scriptParams,
    lootTableId,
    dialogId,
  }: NpcFormValues) => {
    const data = {
      name,
      sprite,
      maxHealth: health,
      attack,
      behavior,
      experienceValue: exp,
      itemsToDrop: drops,
      // Empty means no behavior, rather than "" naming one nobody registers.
      scriptId: scriptId.trim() || undefined,
      // Params without a behavior to read them are dead weight in the document.
      scriptParams:
        scriptId.trim() && Object.keys(scriptParams).length > 0
          ? scriptParams
          : undefined,
      lootTableId: lootTableId || undefined,
      dialogId: dialogId || undefined,
    };
    const result = selectedId
      ? await updateNpc(selectedId, data).catch(() => null)
      : await createNpc(data).catch(() => null);
    chatResultMsg(!!result, 'NPC saved!', 'Error saving NPC');
    // Dangling references never block a save, so this is where their author
    // hears about them.
    for (const warning of result?.warnings ?? []) {
      chatResultMsg(false, '', warning);
    }
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
    setDrops([]);
    setDropsBaseline([]);
  };

  const removeNpc = async () => {
    if (!selectedId) return;
    const ok = await deleteNpc(selectedId)
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, 'NPC deleted!', 'Error deleting NPC');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
    setDrops([]);
    setDropsBaseline([]);
  };

  const behaviorOptions: { value: NpcBehavior; label: string }[] = [
    { value: 'neutral', label: 'Neutral' },
    { value: 'aggressive', label: 'Aggressive' },
    { value: 'hostile', label: 'Hostile' },
    { value: 'friendly', label: 'Friendly' },
    { value: 'shopkeeper', label: 'Shopkeeper' },
    { value: 'guard', label: 'Guard' },
  ];

  const addItem = addItemId ? items.find((i) => i.id === addItemId) : null;

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
          <SpritePreview spriteId={sprite} />
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

      <ScriptBehaviorFields
        events={['onInteract', 'onDeath']}
        scriptId={scriptId}
        onScriptIdChange={(value) =>
          setValue('scriptId', value, { shouldDirty: true })
        }
        params={scriptParams}
        onParamsChange={(value) =>
          setValue('scriptParams', value, { shouldDirty: true })
        }
        hint="Runs when a player talks to this NPC, and when it dies"
        loadItems={loadItems}
        loadNpcs={loadNpcs}
      />

      <div style={dropSection}>
        <label style={{ ...label, marginBottom: 6, display: 'block' }}>
          Dialog
        </label>
        <Controller
          control={control}
          name="dialogId"
          render={({ field }) => (
            <AsyncSelect
              loadOptions={loadDialogs}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <p style={dropHint}>
          {watch('dialogId')
            ? 'Talking to this NPC opens the conversation authored in the Dialogs tab.'
            : 'No dialog: talking to this NPC only fires the behavior above.'}
        </p>
      </div>

      <div style={dropSection}>
        <label style={{ ...label, marginBottom: 6, display: 'block' }}>
          Loot table
        </label>
        <Controller
          control={control}
          name="lootTableId"
          render={({ field }) => (
            <AsyncSelect
              loadOptions={loadLootTables}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <p style={dropHint}>
          {watch('lootTableId')
            ? 'Weighted table in use. The simple drops below are ignored.'
            : 'No table: the simple drops below are used, each rolled on its own.'}
        </p>
      </div>

      <div style={dropSection}>
        <label style={{ ...label, marginBottom: 6, display: 'block' }}>
          Drops
        </label>
        {drops.length > 0 && (
          <div style={dropList}>
            {drops.map((drop, i) => {
              const it = items.find((item) => item.id === drop.itemId);
              return (
                <div key={i} style={dropListRow}>
                  {it && <ItemIcon spriteId={it.sprite} style={dropIcon} />}
                  <span style={dropName}>
                    {it?.name ?? `Item #${drop.itemId}`}
                  </span>
                  <span style={dropStat}>{Math.round(drop.chance * 100)}%</span>
                  <span style={dropStat}>x{drop.quantity ?? 1}</span>
                  <button
                    type="button"
                    style={removeBtn}
                    onClick={() => removeDrop(i)}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <div style={dropAddRow}>
          <div style={{ flex: 1 }}>
            <AsyncSelect<number>
              loadOptions={loadItems}
              value={addItemId}
              onChange={setAddItemId}
            />
          </div>
          <div style={{ width: 70 }}>
            <input
              style={input}
              type="number"
              min={0}
              max={100}
              value={addChance}
              onChange={(e) =>
                setAddChance(Math.min(100, Math.max(0, Number(e.target.value))))
              }
              placeholder="%"
              title="Drop chance %"
            />
          </div>
          <div style={{ width: 60 }}>
            <input
              style={input}
              type="number"
              min={1}
              value={addQty}
              onChange={(e) =>
                setAddQty(Math.max(1, Math.floor(Number(e.target.value))))
              }
              placeholder="Qty"
              title="Quantity"
            />
          </div>
          {addItem && <ItemIcon spriteId={addItem.sprite} style={dropIcon} />}
          <button
            type="button"
            style={addBtn}
            onClick={addDrop}
            disabled={!addItemId}
          >
            + Add
          </button>
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

const dropSection: React.CSSProperties = {
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
};

const dropHint: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
  margin: '6px 0 0',
};

const dropList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  marginBottom: 8,
};

const dropListRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const dropAddRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const dropName: React.CSSProperties = {
  flex: 1,
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const dropStat: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
  minWidth: 36,
  textAlign: 'right',
};

const dropIcon: React.CSSProperties = {
  width: 28,
  height: 28,
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

const removeBtn: React.CSSProperties = {
  background: 'transparent',
  color: colors.textMuted,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  padding: '2px 4px',
  lineHeight: 1,
  flexShrink: 0,
};

const addBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '7px 10px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
  flexShrink: 0,
};
