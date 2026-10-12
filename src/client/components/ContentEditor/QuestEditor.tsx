import React from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Quest, QuestObjective } from '../../../shared/types';
import { saveQuest, deleteQuest } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { Select } from '../common/Select/Select';
import { editorStyles } from '../../theme';
import {
  useEntrySelection,
  type EditorGuardProps,
} from '../../hooks/useEntrySelection';
import { useT, type TranslationKey } from '../../i18n';

const {
  container,
  field,
  label,
  input,
  box,
  boxHeader,
  entryRow,
  emptyHint,
  actions,
  saveBtn,
  deleteBtn,
  ghostBtn,
  addBtn,
  removeBtn,
} = editorStyles;

interface QuestEditorProps extends EditorGuardProps {
  quests: Quest[];
  loadQuests: () => Promise<{ value: string; label: string }[]>;
  loadNpcs: () => Promise<{ value: string; label: string }[]>;
  loadItems: () => Promise<{ value: number; label: string }[]>;
  loadMaps: () => Promise<{ value: string; label: string }[]>;
  refreshData: () => void;
}

type ObjectiveType = QuestObjective['type'];

// The objective is a union in the document but flat in the form, which
// needs a stable field per input; it is folded back on save.
type QuestFormValues = {
  id: string;
  name: string;
  description: string;
  objectiveType: ObjectiveType;
  npcId: string;
  itemId: number;
  count: number;
  mapId: string;
  row: number;
  col: number;
  experience: number;
  rewardItems: { itemId: number; quantity: number }[];
  rewardScript: string;
};

const defaultValues: QuestFormValues = {
  id: '',
  name: '',
  description: '',
  objectiveType: 'kill',
  npcId: '',
  itemId: 0,
  count: 1,
  mapId: '',
  row: 0,
  col: 0,
  experience: 0,
  rewardItems: [],
  rewardScript: '',
};

const questToForm = (quest: Quest): QuestFormValues => {
  const objective = quest.objective;
  return {
    ...defaultValues,
    id: quest.id,
    name: quest.name,
    description: quest.description ?? '',
    objectiveType: objective.type,
    npcId:
      objective.type === 'kill' || objective.type === 'talk'
        ? objective.npcId
        : '',
    itemId: objective.type === 'collect' ? objective.itemId : 0,
    count:
      objective.type === 'kill' || objective.type === 'collect'
        ? objective.count
        : 1,
    mapId: objective.type === 'reach' ? objective.mapId : '',
    row: objective.type === 'reach' ? objective.row : 0,
    col: objective.type === 'reach' ? objective.col : 0,
    experience: quest.reward?.experience ?? 0,
    rewardItems: (quest.reward?.items ?? []).map((entry) => ({
      itemId: entry.itemId,
      quantity: entry.quantity,
    })),
    rewardScript: quest.reward?.script ?? '',
  };
};

const buildObjective = (values: QuestFormValues): QuestObjective => {
  switch (values.objectiveType) {
    case 'collect':
      return {
        type: 'collect',
        itemId: values.itemId,
        count: Math.max(1, values.count),
      };
    case 'talk':
      return { type: 'talk', npcId: values.npcId.trim() };
    case 'reach':
      return {
        type: 'reach',
        mapId: values.mapId.trim(),
        row: values.row,
        col: values.col,
      };
    default:
      return {
        type: 'kill',
        npcId: values.npcId.trim(),
        count: Math.max(1, values.count),
      };
  }
};

const objectiveTypes: { value: ObjectiveType; label: TranslationKey }[] = [
  { value: 'kill', label: 'questEditor.typeKill' },
  { value: 'collect', label: 'questEditor.typeCollect' },
  { value: 'talk', label: 'questEditor.typeTalk' },
  { value: 'reach', label: 'questEditor.typeReach' },
];

const hints: Record<ObjectiveType, TranslationKey> = {
  kill: 'questEditor.hintKill',
  collect: 'questEditor.hintCollect',
  talk: 'questEditor.hintTalk',
  reach: 'questEditor.hintReach',
};

export const QuestEditor: React.FC<QuestEditorProps> = ({
  quests,
  loadQuests,
  loadNpcs,
  loadItems,
  loadMaps,
  refreshData,
  ...guard
}) => {
  const t = useT();
  const {
    control,
    formState: { isDirty },
    handleSubmit,
    register,
    reset: resetForm,
    watch,
  } = useForm<QuestFormValues>({ defaultValues });

  const rewardItems = useFieldArray({ control, name: 'rewardItems' });
  const objectiveType = watch('objectiveType');

  const { selectedId, clear, open, startNew } = useEntrySelection(
    isDirty,
    guard,
    () => resetForm(defaultValues),
  );

  const selectQuest = async (id: string) => {
    if (!(await open(id))) return;
    const quest = quests.find((q) => q.id === id);
    if (quest) resetForm(questToForm(quest));
  };

  const save = async (values: QuestFormValues) => {
    // Only keys that carry something are sent, so a quest with no reward has
    // no `reward` at all.
    const items = values.rewardItems.filter((entry) => entry.quantity > 0);
    const reward = {
      ...(values.experience > 0 ? { experience: values.experience } : {}),
      ...(items.length > 0 ? { items } : {}),
      ...(values.rewardScript.trim()
        ? { script: values.rewardScript.trim() }
        : {}),
    };
    const quest: Quest = {
      id: values.id.trim(),
      name: values.name,
      ...(values.description.trim()
        ? { description: values.description.trim() }
        : {}),
      objective: buildObjective(values),
      ...(Object.keys(reward).length > 0 ? { reward } : {}),
    };
    const result = await saveQuest(quest).catch(() => null);
    chatResultMsg(!!result, t('questEditor.saved'), t('questEditor.saveError'));
    for (const warning of result?.warnings ?? []) {
      chatResultMsg(false, '', warning);
    }
    if (!result) return;
    refreshData();
    clear();
  };

  const remove = async () => {
    if (!selectedId) return;
    const ok = await deleteQuest(selectedId)
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, t('questEditor.deleted'), t('questEditor.deleteError'));
    if (!ok) return;
    refreshData();
    clear();
  };

  return (
    <form style={container} onSubmit={handleSubmit(save)}>
      <div style={field}>
        <label style={label}>{t('npc.quest')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadQuests}
              value={selectedId}
              onChange={(id) => void selectQuest(id)}
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={field}>
          <label style={label}>{t('editor.id')}</label>
          <input
            style={{ ...input, ...(selectedId ? { opacity: 0.5 } : {}) }}
            {...register('id')}
            placeholder={t('questEditor.idPlaceholder')}
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('editor.name')}</label>
          <input
            style={input}
            {...register('name')}
            placeholder={t('questEditor.namePlaceholder')}
          />
        </div>
      </div>

      <div style={field}>
        <label style={label}>{t('editor.description')}</label>
        <textarea
          style={{ ...input, minHeight: 46, resize: 'vertical' }}
          {...register('description')}
          placeholder={t('questEditor.descPlaceholder')}
        />
      </div>

      <div style={box}>
        <span style={label}>{t('questEditor.objective')}</span>
        <Controller
          control={control}
          name="objectiveType"
          render={({ field: type }) => (
            <Select
              options={objectiveTypes.map(({ value, label }) => ({
                value,
                label: t(label),
              }))}
              value={type.value}
              onChange={type.onChange}
            />
          )}
        />
        <p style={emptyHint}>{t(hints[objectiveType])}</p>

        {(objectiveType === 'kill' || objectiveType === 'talk') && (
          <div style={field}>
            <label style={label}>{t('npc.npc')}</label>
            <Controller
              control={control}
              name="npcId"
              render={({ field: npc }) => (
                <AsyncSelect
                  loadOptions={loadNpcs}
                  value={npc.value}
                  onChange={npc.onChange}
                />
              )}
            />
          </div>
        )}

        {objectiveType === 'collect' && (
          <div style={field}>
            <label style={label}>{t('item.item')}</label>
            <Controller
              control={control}
              name="itemId"
              render={({ field: item }) => (
                <AsyncSelect
                  loadOptions={loadItems}
                  value={item.value}
                  onChange={item.onChange}
                />
              )}
            />
          </div>
        )}

        {(objectiveType === 'kill' || objectiveType === 'collect') && (
          <div style={field}>
            <label style={label}>{t('questEditor.howMany')}</label>
            <input
              style={input}
              type="number"
              min={1}
              {...register('count', { valueAsNumber: true })}
            />
          </div>
        )}

        {objectiveType === 'reach' && (
          <>
            <div style={field}>
              <label style={label}>{t('map.map')}</label>
              <Controller
                control={control}
                name="mapId"
                render={({ field: map }) => (
                  <AsyncSelect
                    loadOptions={loadMaps}
                    value={map.value}
                    onChange={map.onChange}
                  />
                )}
              />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ ...field, flex: 1 }}>
                <label style={label}>{t('questEditor.row')}</label>
                <input
                  style={input}
                  type="number"
                  min={0}
                  {...register('row', { valueAsNumber: true })}
                />
              </div>
              <div style={{ ...field, flex: 1 }}>
                <label style={label}>{t('questEditor.col')}</label>
                <input
                  style={input}
                  type="number"
                  min={0}
                  {...register('col', { valueAsNumber: true })}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>{t('questEditor.reward')}</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => rewardItems.append({ itemId: 0, quantity: 1 })}
          >
            {t('questEditor.addItem')}
          </button>
        </div>
        <div style={field}>
          <label style={label}>{t('questEditor.experience')}</label>
          <input
            style={input}
            type="number"
            min={0}
            {...register('experience', { valueAsNumber: true })}
          />
        </div>
        {rewardItems.fields.map((entry, i) => (
          <div key={entry.id} style={entryRow}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <label style={label}>{t('item.item')}</label>
              <Controller
                control={control}
                name={`rewardItems.${i}.itemId` as const}
                render={({ field: item }) => (
                  <AsyncSelect
                    loadOptions={loadItems}
                    value={item.value}
                    onChange={item.onChange}
                  />
                )}
              />
            </div>
            <div style={{ width: 90, flexShrink: 0 }}>
              <label style={label}>{t('npc.qty')}</label>
              <input
                style={input}
                type="number"
                min={1}
                {...register(`rewardItems.${i}.quantity` as const, {
                  valueAsNumber: true,
                })}
              />
            </div>
            <button
              type="button"
              style={removeBtn}
              onClick={() => rewardItems.remove(i)}
              title={t('questEditor.removeReward')}
            >
              ✕
            </button>
          </div>
        ))}
        <div style={field}>
          <label style={label} title={t('questEditor.scriptRewardHelp')}>
            {t('questEditor.scriptReward')}
          </label>
          <input
            style={input}
            {...register('rewardScript')}
            placeholder={t('questEditor.scriptRewardPlaceholder')}
          />
          <p style={emptyHint}>{t('questEditor.scriptRewardNote')}</p>
        </div>
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? t('questEditor.save') : t('questEditor.createBtn')}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        )}
      </div>
    </form>
  );
};
