import React, { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Effect, Item, ModifiablePlayerAttribute } from '../../../shared/types';
import {
  updateItem,
  createItem,
  deleteItem,
  fetchArrows,
} from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { ItemIcon } from '../Inventory/ItemIcon';
import { ScriptBehaviorFields } from './ScriptBehaviorFields';
import {
  itemBehaviorEvents,
  type ScriptParams,
} from '../../../shared/scriptParams';
import { colors, radius } from '../../theme';
import { useT, type TranslationKey } from '../../i18n';

interface ItemEditorProps {
  items: Item[];
  loadItems: () => Promise<any>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

type EffectRow = {
  attribute: ModifiablePlayerAttribute;
  type: Effect['type'];
  value: number;
};

type ItemFormValues = {
  name: string;
  sprite: number;
  desc: string;
  type: Item['type'];
  effects: EffectRow[];
  arrowId: number | '';
  bound: boolean;
  scriptId: string;
  scriptParams: ScriptParams;
};

const defaultValues: ItemFormValues = {
  name: '',
  sprite: 0,
  desc: '',
  type: 'weapon',
  effects: [],
  arrowId: '',
  bound: false,
  scriptId: '',
  scriptParams: {},
};

/** What running a behaviour means for this item, since the type decides. */
const behaviorHint = (type: Item['type']): TranslationKey => {
  if (type === 'consumable') return 'item.hintConsumable';
  const [equip] = itemBehaviorEvents(type);
  if (equip) return 'item.hintEquip';
  return 'item.hintNone';
};

const itemToFormValues = (item: Item): ItemFormValues => ({
  name: item.name,
  sprite: item.sprite,
  desc: item.description ?? '',
  type: item.type,
  effects: (item.effects ?? []).map((e) => ({
    attribute: e.attribute,
    type: e.type,
    value: e.value,
  })),
  arrowId: item.arrowId ?? '',
  bound: item.bound ?? false,
  scriptId: item.scriptId ?? '',
  scriptParams: item.scriptParams ?? {},
});

const ALL_ATTRIBUTES: {
  value: ModifiablePlayerAttribute;
  label: TranslationKey;
  meleeOnly?: true;
}[] = [
  { value: 'health', label: 'attr.health' },
  { value: 'maxHealth', label: 'attr.maxHealth' },
  { value: 'attack', label: 'attr.attack', meleeOnly: true },
  { value: 'strength', label: 'attr.strength' },
  { value: 'defense', label: 'attr.defense' },
  { value: 'agility', label: 'attr.agility' },
  { value: 'vitality', label: 'attr.vitality' },
  { value: 'speed', label: 'attr.speed' },
  { value: 'attackRange', label: 'attr.attackRange', meleeOnly: true },
  { value: 'experience', label: 'attr.experience' },
  { value: 'level', label: 'attr.level' },
];

export const ItemEditor: React.FC<ItemEditorProps> = ({
  items,
  loadItems,
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
  } = useForm<ItemFormValues>({ defaultValues });
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'effects',
  });

  const sprite = watch('sprite');
  const type = watch('type');
  const arrowId = watch('arrowId');
  const scriptId = watch('scriptId');
  const scriptParams = watch('scriptParams');
  const isRanged = type === 'weapon' && arrowId !== '';

  const attributes = (
    isRanged ? ALL_ATTRIBUTES.filter((a) => !a.meleeOnly) : ALL_ATTRIBUTES
  ).map(({ value, label }) => ({ value, label: t(label) }));

  const loadArrowOptions = async () => {
    const data = await fetchArrows();
    return [
      { value: '' as const, label: t('editor.none') },
      ...data.map((a) => ({
        value: String(a.id),
        label: `${a.id} - ${a.name}`,
      })),
    ];
  };

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

  const selectItem = async (id: number) => {
    if (!(await requestDiscard())) return;
    setSelectedId(String(id));
    const item = items.find((i) => i.id === id);
    if (item) resetForm(itemToFormValues(item));
  };

  const saveItem = async ({
    name,
    sprite,
    desc,
    type,
    effects,
    arrowId,
    bound,
    scriptId,
    scriptParams,
  }: ItemFormValues) => {
    const data = {
      name,
      sprite,
      description: desc,
      type,
      effects,
      ...(arrowId !== '' && { arrowId: Number(arrowId) }),
      bound,
      // Empty means no behavior, rather than "" naming one that cannot exist.
      scriptId: scriptId.trim() || undefined,
      // Params without a behavior to read them are dead weight in the document.
      scriptParams:
        scriptId.trim() && Object.keys(scriptParams).length > 0
          ? scriptParams
          : undefined,
    };
    const result = selectedId
      ? await updateItem(Number(selectedId), data)
      : await createItem(data);
    chatResultMsg(!!result, t('item.saved'), t('item.saveError'));
    // Dangling references never block a save, so this is where their author
    // hears about them.
    for (const warning of result?.warnings ?? []) {
      chatResultMsg(false, '', warning);
    }
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const removeItem = async () => {
    if (!selectedId) return;
    await deleteItem(Number(selectedId));
    chatResultMsg(true, t('item.deleted'), t('item.deleteError'));
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const typeOptions: { value: Item['type']; label: string }[] = [
    { value: 'weapon', label: t('item.typeWeapon') },
    { value: 'helmet', label: t('item.typeHelmet') },
    { value: 'chestplate', label: t('item.typeChestplate') },
    { value: 'gloves', label: t('item.typeGloves') },
    { value: 'boots', label: t('item.typeBoots') },
    { value: 'consumable', label: t('item.typeConsumable') },
    { value: 'money', label: t('item.typeMoney') },
  ];

  return (
    <form style={container} onSubmit={handleSubmit(saveItem)}>
      <div style={field}>
        <label style={label}>{t('item.item')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect<Item['id']>
              loadOptions={loadItems}
              value={selectedId ? Number(selectedId) : 0}
              onChange={(id) => void selectItem(id)}
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
          <ItemIcon spriteId={sprite ?? 0} style={previewIcon} />
          <div style={field}>
            <label style={label}>{t('editor.spriteId')}</label>
            <input
              style={input}
              type="number"
              {...register('sprite', { setValueAs: Number })}
              placeholder="0"
            />
          </div>
        </div>

        <div style={rightCol}>
          <div style={field}>
            <label style={label}>{t('editor.name')}</label>
            <input
              style={input}
              {...register('name')}
              placeholder={t('item.namePlaceholder')}
            />
          </div>
          <div style={field}>
            <label style={label}>{t('editor.type')}</label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <AsyncSelect<Item['type']>
                  loadOptions={() => Promise.resolve(typeOptions)}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div style={field}>
            <label style={label}>{t('editor.description')}</label>
            <input
              style={input}
              {...register('desc')}
              placeholder={t('item.descPlaceholder')}
            />
          </div>
          <label style={checkboxField}>
            <input type="checkbox" {...register('bound')} />
            {t('item.bound')}
          </label>
          <ScriptBehaviorFields
            events={itemBehaviorEvents(type)}
            scriptId={scriptId}
            onScriptIdChange={(value) =>
              setValue('scriptId', value, { shouldDirty: true })
            }
            params={scriptParams}
            onParamsChange={(value) =>
              setValue('scriptParams', value, { shouldDirty: true })
            }
            hint={t(behaviorHint(type))}
            loadItems={loadItems}
          />
          {type === 'weapon' && (
            <div style={field}>
              <label style={label}>{t('item.arrow')}</label>
              <Controller
                control={control}
                name="arrowId"
                render={({ field }) => (
                  <AsyncSelect<string>
                    loadOptions={loadArrowOptions}
                    value={field.value === '' ? '' : String(field.value)}
                    onChange={(v) => field.onChange(v === '' ? '' : Number(v))}
                  />
                )}
              />
            </div>
          )}
        </div>
      </div>

      <div style={effectsBox}>
        <div style={effectsHeader}>
          <span style={label}>{t('item.effects')}</span>
          <button
            type="button"
            style={addBtn}
            onClick={() =>
              append({ attribute: 'health', type: 'add', value: 0 })
            }
          >
            {t('editor.add')}
          </button>
        </div>

        {fields.length === 0 && <p style={emptyHint}>{t('item.noEffects')}</p>}

        {fields.map((f, i) => (
          <div key={f.id} style={effectRow}>
            <div style={{ flex: 3, minWidth: 0 }}>
              <Controller
                control={control}
                name={`effects.${i}.attribute`}
                render={({ field }) => (
                  <AsyncSelect<ModifiablePlayerAttribute>
                    loadOptions={() => Promise.resolve(attributes)}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            <div style={{ width: 60, flexShrink: 0 }}>
              <Controller
                control={control}
                name={`effects.${i}.type`}
                render={({ field }) => (
                  <AsyncSelect<Effect['type']>
                    loadOptions={() =>
                      Promise.resolve([
                        { value: 'add' as const, label: t('effect.add') },
                        {
                          value: 'multiply' as const,
                          label: t('effect.multiply'),
                        },
                      ])
                    }
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            <div style={{ width: 68, flexShrink: 0 }}>
              <input
                style={input}
                type="number"
                {...register(`effects.${i}.value`, { setValueAs: Number })}
              />
            </div>
            <button
              type="button"
              style={removeEffectBtn}
              onClick={() => remove(i)}
              title={t('item.removeEffect')}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? t('item.save') : t('item.createBtn')}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={removeItem}>
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

const previewIcon: React.CSSProperties = {
  width: 64,
  height: 64,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  background: colors.surfaceMuted,
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

const checkboxField: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: colors.text,
  cursor: 'pointer',
};

const effectsBox: React.CSSProperties = {
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const effectsHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const effectRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const emptyHint: React.CSSProperties = {
  fontSize: 13,
  color: colors.textMuted,
  margin: 0,
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

const addBtn: React.CSSProperties = {
  background: 'transparent',
  color: colors.info,
  border: `1px solid ${colors.primary}`,
  padding: '3px 10px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
};

const removeEffectBtn: React.CSSProperties = {
  background: 'transparent',
  color: colors.textMuted,
  border: 'none',
  padding: '0 4px',
  cursor: 'pointer',
  fontSize: 14,
};
