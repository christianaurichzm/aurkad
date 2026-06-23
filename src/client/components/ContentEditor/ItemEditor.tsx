import React, { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Effect, Item, ModifiablePlayerAttribute } from '../../../shared/types';
import { updateItem, createItem, deleteItem } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { ItemIcon } from '../Inventory/ItemIcon';
import { colors, radius } from '../../theme';

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
};

const defaultValues: ItemFormValues = {
  name: '',
  sprite: 0,
  desc: '',
  type: 'weapon',
  effects: [],
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
});

const ATTRIBUTES: { value: ModifiablePlayerAttribute; label: string }[] = [
  { value: 'health', label: 'Health' },
  { value: 'maxHealth', label: 'Max Health' },
  { value: 'attack', label: 'Attack' },
  { value: 'strength', label: 'Strength' },
  { value: 'defense', label: 'Defense' },
  { value: 'agility', label: 'Agility' },
  { value: 'vitality', label: 'Vitality' },
  { value: 'speed', label: 'Speed' },
  { value: 'attackRange', label: 'Attack Range' },
  { value: 'experience', label: 'Experience' },
  { value: 'level', label: 'Level' },
];

export const ItemEditor: React.FC<ItemEditorProps> = ({
  items,
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
  } = useForm<ItemFormValues>({ defaultValues });
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'effects',
  });

  const sprite = watch('sprite');

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
  }: ItemFormValues) => {
    const data = { name, sprite, description: desc, type, effects };
    const result = selectedId
      ? await updateItem(Number(selectedId), data)
      : await createItem(data);
    chatResultMsg(!!result, 'Item saved!', 'Error saving item');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const removeItem = async () => {
    if (!selectedId) return;
    await deleteItem(Number(selectedId));
    chatResultMsg(true, 'Item deleted!', 'Error deleting item');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const typeOptions: { value: Item['type']; label: string }[] = [
    { value: 'weapon', label: 'Weapon' },
    { value: 'helmet', label: 'Helmet' },
    { value: 'chestplate', label: 'Chestplate' },
    { value: 'gloves', label: 'Gloves' },
    { value: 'boots', label: 'Boots' },
    { value: 'consumable', label: 'Consumable' },
    { value: 'money', label: 'Money' },
  ];

  return (
    <form style={container} onSubmit={handleSubmit(saveItem)}>
      <div style={field}>
        <label style={label}>Item</label>
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
              New
            </button>
          )}
        </div>
      </div>

      <div style={cols}>
        <div style={leftCol}>
          <ItemIcon spriteId={sprite ?? 0} style={previewIcon} />
          <div style={field}>
            <label style={label}>Sprite ID</label>
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
            <label style={label}>Name</label>
            <input
              style={input}
              {...register('name')}
              placeholder="Item name"
            />
          </div>
          <div style={field}>
            <label style={label}>Type</label>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <AsyncSelect<Item['type']>
                  loadOptions={async () => typeOptions}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          <div style={field}>
            <label style={label}>Description</label>
            <input
              style={input}
              {...register('desc')}
              placeholder="Optional description"
            />
          </div>
        </div>
      </div>

      <div style={effectsBox}>
        <div style={effectsHeader}>
          <span style={label}>Effects</span>
          <button
            type="button"
            style={addBtn}
            onClick={() =>
              append({ attribute: 'health', type: 'add', value: 0 })
            }
          >
            + Add
          </button>
        </div>

        {fields.length === 0 && (
          <p style={emptyHint}>
            No effects. Click + Add to define stat changes.
          </p>
        )}

        {fields.map((f, i) => (
          <div key={f.id} style={effectRow}>
            <div style={{ flex: 3, minWidth: 0 }}>
              <Controller
                control={control}
                name={`effects.${i}.attribute`}
                render={({ field }) => (
                  <AsyncSelect<ModifiablePlayerAttribute>
                    loadOptions={async () => ATTRIBUTES}
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
                    loadOptions={async () => [
                      { value: 'add' as const, label: '+ add' },
                      { value: 'multiply' as const, label: '× mul' },
                    ]}
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
              title="Remove effect"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? 'Save Item' : 'Create Item'}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={removeItem}>
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
  color: colors.primary,
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
