import React, { useState, useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { RuntimeNpc, NpcBehavior } from '../../../shared/types';
import { updateNpc, createNpc, deleteNpc } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { SpritePreview } from '../common/SpritePreview';
import { ScriptBehaviorFields } from './ScriptBehaviorFields';
import type { ScriptParams } from '../../../shared/scriptParams';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

interface NpcEditorProps {
  npcs: RuntimeNpc[];
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
  respawnMs: string;
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
  respawnMs: '',
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
  respawnMs: npc.respawnMs?.toString() ?? '',
});

export const NpcEditor: React.FC<NpcEditorProps> = ({
  npcs,
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

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

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
    scriptId,
    scriptParams,
    lootTableId,
    dialogId,
    questId,
    sight,
    pathDepth,
    leash,
    moveIntervalMs,
    respawnMs,
  }: NpcFormValues) => {
    const data = {
      name,
      sprite,
      maxHealth: health,
      attack,
      behavior,
      experienceValue: exp,
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
      respawnMs: optionalNumber(respawnMs),
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
  };

  const behaviorOptions: { value: NpcBehavior; label: string }[] = [
    { value: 'neutral', label: t('npc.behaviorNeutral') },
    { value: 'aggressive', label: t('npc.behaviorAggressive') },
    { value: 'hostile', label: t('npc.behaviorHostile') },
    { value: 'friendly', label: t('npc.behaviorFriendly') },
    { value: 'shopkeeper', label: t('npc.behaviorShopkeeper') },
    { value: 'guard', label: t('npc.behaviorGuard') },
  ];

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
          <div style={{ ...triRow, marginTop: 8 }}>
            <div style={field}>
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
            <div style={field}>
              <label style={label}>{t('npc.respawnAfter')}</label>
              <input
                style={input}
                type="number"
                min={0}
                max={3600000}
                placeholder="0"
                {...register('respawnMs')}
              />
            </div>
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
