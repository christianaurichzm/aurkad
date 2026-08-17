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
import { useT } from '../../i18n';

interface NpcEditorProps {
  npcs: RuntimeNpc[];
  items: Item[];
  loadNpcs: () => Promise<any>;
  loadItems: () => Promise<any>;
  loadLootTables: () => Promise<{ value: string; label: string }[]>;
  loadDialogs: () => Promise<{ value: string; label: string }[]>;
  loadQuests: () => Promise<{ value: string; label: string }[]>;
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
  questId: string;
  // Strings, so empty survives the round trip: absent selects the engine
  // default for the behaviour.
  sight: string;
  pathDepth: string;
  leash: string;
  moveIntervalMs: string;
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
  questId: '',
  sight: '',
  pathDepth: '',
  leash: '',
  moveIntervalMs: '',
};

// Empty reaches the server as absent, not 0, so the engine default applies.
const optionalNumber = (value: string): number | undefined => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : Number(trimmed);
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
  questId: npc.questId ?? '',
  sight: npc.sight?.toString() ?? '',
  pathDepth: npc.pathDepth?.toString() ?? '',
  leash: npc.leash?.toString() ?? '',
  moveIntervalMs: npc.moveIntervalMs?.toString() ?? '',
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
  loadQuests,
  refreshData,
  onDirtyChange,
  requestDiscard,
}) => {
  const t = useT();
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
  const behavior = watch('behavior');
  // The chase fields only matter for behaviours that chase.
  const hunts = behavior === 'aggressive' || behavior === 'hostile';

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
    questId,
    sight,
    pathDepth,
    leash,
    moveIntervalMs,
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
      questId: questId || undefined,
      sight: optionalNumber(sight),
      pathDepth: optionalNumber(pathDepth),
      leash: optionalNumber(leash),
      moveIntervalMs: optionalNumber(moveIntervalMs),
    };
    const result = selectedId
      ? await updateNpc(selectedId, data).catch(() => null)
      : await createNpc(data).catch(() => null);
    chatResultMsg(!!result, t('npc.saved'), t('npc.saveError'));
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
    chatResultMsg(ok, t('npc.deleted'), t('npc.deleteError'));
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
    setDrops([]);
    setDropsBaseline([]);
  };

  const behaviorOptions: { value: NpcBehavior; label: string }[] = [
    { value: 'neutral', label: t('npc.behaviorNeutral') },
    { value: 'aggressive', label: t('npc.behaviorAggressive') },
    { value: 'hostile', label: t('npc.behaviorHostile') },
    { value: 'friendly', label: t('npc.behaviorFriendly') },
    { value: 'shopkeeper', label: t('npc.behaviorShopkeeper') },
    { value: 'guard', label: t('npc.behaviorGuard') },
  ];

  const addItem = addItemId ? items.find((i) => i.id === addItemId) : null;

  return (
    <form style={container} onSubmit={handleSubmit(saveNpc)}>
      <div style={field}>
        <label style={label}>{t('npc.npc')}</label>
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
              {t('editor.new')}
            </button>
          )}
        </div>
      </div>

      <div style={cols}>
        <div style={leftCol}>
          <SpritePreview spriteId={sprite} />
          <div style={field}>
            <label style={label}>{t('editor.spriteId')}</label>
            <input
              style={input}
              type="number"
              {...register('sprite', { setValueAs: Number })}
            />
          </div>
        </div>

        <div style={rightCol}>
          <div style={field}>
            <label style={label}>{t('editor.name')}</label>
            <input
              style={input}
              {...register('name')}
              placeholder={t('npc.namePlaceholder')}
            />
          </div>
          <div style={field}>
            <label style={label}>{t('npc.behavior')}</label>
            <Controller
              control={control}
              name="behavior"
              render={({ field }) => (
                <AsyncSelect<NpcBehavior>
                  loadOptions={() => Promise.resolve(behaviorOptions)}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div style={triRow}>
            <div style={field}>
              <label style={label}>{t('npc.hp')}</label>
              <input
                style={input}
                type="number"
                {...register('health', { setValueAs: Number })}
              />
            </div>
            <div style={field}>
              <label style={label}>{t('npc.atk')}</label>
              <input
                style={input}
                type="number"
                {...register('attack', { setValueAs: Number })}
              />
            </div>
            <div style={field}>
              <label style={label}>{t('npc.exp')}</label>
              <input
                style={input}
                type="number"
                {...register('exp', { setValueAs: Number })}
              />
            </div>
          </div>
        </div>
      </div>

      {hunts && (
        <div style={dropSection}>
          <label style={{ ...label, marginBottom: 6, display: 'block' }}>
            {t('npc.ai')}
          </label>
          <div style={triRow}>
            <div style={field}>
              <label style={label}>{t('npc.sight')}</label>
              <input
                style={input}
                type="number"
                min={1}
                max={20}
                placeholder={behavior === 'aggressive' ? '8' : '4'}
                {...register('sight')}
              />
            </div>
            <div style={field}>
              <label style={label}>{t('npc.pathDepth')}</label>
              <input
                style={input}
                type="number"
                min={0}
                max={40}
                placeholder="30"
                {...register('pathDepth')}
              />
            </div>
            <div style={field}>
              <label style={label}>{t('npc.leash')}</label>
              <input
                style={input}
                type="number"
                min={0}
                max={60}
                placeholder="12"
                {...register('leash')}
              />
            </div>
          </div>
          <div style={{ ...field, marginTop: 8, maxWidth: 180 }}>
            <label style={label}>{t('npc.stepEvery')}</label>
            <input
              style={input}
              type="number"
              min={50}
              max={60000}
              placeholder="1250"
              {...register('moveIntervalMs')}
            />
          </div>
          <p style={dropHint}>{t('npc.aiHint')}</p>
        </div>
      )}

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
        hint={t('npc.behaviorHint')}
        loadItems={loadItems}
        loadNpcs={loadNpcs}
      />

      <div style={dropSection}>
        <label style={{ ...label, marginBottom: 6, display: 'block' }}>
          {t('npc.dialog')}
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
          {watch('dialogId') ? t('npc.dialogSet') : t('npc.dialogNone')}
        </p>
      </div>

      <div style={dropSection}>
        <label style={{ ...label, marginBottom: 6, display: 'block' }}>
          {t('npc.quest')}
        </label>
        <Controller
          control={control}
          name="questId"
          render={({ field }) => (
            <AsyncSelect
              loadOptions={loadQuests}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
        <p style={dropHint}>
          {watch('questId') ? t('npc.questSet') : t('npc.questNone')}
        </p>
      </div>

      <div style={dropSection}>
        <label style={{ ...label, marginBottom: 6, display: 'block' }}>
          {t('npc.lootTable')}
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
          {watch('lootTableId') ? t('npc.lootSet') : t('npc.lootNone')}
        </p>
      </div>

      <div style={dropSection}>
        <label style={{ ...label, marginBottom: 6, display: 'block' }}>
          {t('npc.drops')}
        </label>
        {drops.length > 0 && (
          <div style={dropList}>
            {drops.map((drop, i) => {
              const it = items.find((item) => item.id === drop.itemId);
              return (
                <div key={i} style={dropListRow}>
                  {it && <ItemIcon spriteId={it.sprite} style={dropIcon} />}
                  <span style={dropName}>
                    {it?.name ?? t('npc.itemNumber', { id: drop.itemId })}
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
              title={t('npc.dropChance')}
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
              placeholder={t('npc.qty')}
              title={t('npc.quantity')}
            />
          </div>
          {addItem && <ItemIcon spriteId={addItem.sprite} style={dropIcon} />}
          <button
            type="button"
            style={addBtn}
            onClick={addDrop}
            disabled={!addItemId}
          >
            {t('editor.add')}
          </button>
        </div>
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? t('npc.save') : t('npc.createBtn')}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={removeNpc}>
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
