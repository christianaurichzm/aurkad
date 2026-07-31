import React, { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { LootQuantity, LootTable } from '../../../shared/types';
import { saveLootTable, deleteLootTable } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { colors, radius } from '../../theme';

interface LootTableEditorProps {
  tables: LootTable[];
  loadTables: () => Promise<{ value: string; label: string }[]>;
  loadItems: () => Promise<{ value: number; label: string }[]>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

// The form splits quantity into two numbers, since a field cannot be a
// number or a range; it is folded back on save.
type EntryRow = {
  itemId: number;
  weight: number;
  chance: number;
  minQty: number;
  maxQty: number;
  /** Empty means unconditional; see the field's help text below. */
  condition: string;
};

type LootFormValues = {
  id: string;
  name: string;
  guaranteed: EntryRow[];
  entries: EntryRow[];
  minRolls: number;
  maxRolls: number;
  emptyWeight: number;
};

const defaultValues: LootFormValues = {
  id: '',
  name: '',
  guaranteed: [],
  entries: [],
  minRolls: 1,
  maxRolls: 1,
  emptyWeight: 0,
};

const quantityToRow = (
  quantity: LootQuantity | undefined,
): { minQty: number; maxQty: number } => {
  if (quantity === undefined) return { minQty: 1, maxQty: 1 };
  if (typeof quantity === 'number') {
    return { minQty: quantity, maxQty: quantity };
  }
  return { minQty: quantity.min, maxQty: quantity.max };
};

const tableToForm = (table: LootTable): LootFormValues => ({
  id: table.id,
  name: table.name,
  guaranteed: (table.guaranteed ?? []).map((e) => ({
    itemId: e.itemId,
    weight: e.weight ?? 1,
    chance: e.chance ?? 1,
    condition: e.condition ?? '',
    ...quantityToRow(e.quantity),
  })),
  entries: (table.entries ?? []).map((e) => ({
    itemId: e.itemId,
    weight: e.weight ?? 1,
    chance: e.chance ?? 1,
    condition: e.condition ?? '',
    ...quantityToRow(e.quantity),
  })),
  minRolls: table.rolls?.min ?? 1,
  maxRolls: table.rolls?.max ?? 1,
  emptyWeight: table.emptyWeight ?? 0,
});

const rowToEntry = (row: EntryRow, includeChance: boolean) => ({
  itemId: row.itemId,
  ...(includeChance ? { chance: row.chance } : { weight: row.weight }),
  // Omitted when empty, so an unconditional entry stores no condition.
  ...(row.condition.trim() ? { condition: row.condition.trim() } : {}),
  // A fixed amount stays a plain number, so a table without ranges saves back
  // exactly as it was.
  quantity:
    row.minQty === row.maxQty
      ? row.minQty
      : { min: row.minQty, max: row.maxQty },
});

const newRow = (): EntryRow => ({
  itemId: 0,
  weight: 1,
  chance: 1,
  minQty: 1,
  maxQty: 1,
  condition: '',
});

export const LootTableEditor: React.FC<LootTableEditorProps> = ({
  tables,
  loadTables,
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
  } = useForm<LootFormValues>({ defaultValues });

  const guaranteed = useFieldArray({ control, name: 'guaranteed' });
  const entries = useFieldArray({ control, name: 'entries' });
  const watchedEntries = watch('entries');
  const emptyWeight = Number(watch('emptyWeight')) || 0;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

  const selectTable = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
    const table = tables.find((t) => t.id === id);
    if (table) resetForm(tableToForm(table));
  };

  const save = async (values: LootFormValues) => {
    const table: LootTable = {
      id: values.id,
      name: values.name,
      guaranteed: values.guaranteed.map((r) => rowToEntry(r, true)),
      entries: values.entries.map((r) => rowToEntry(r, false)),
      rolls: { min: Number(values.minRolls), max: Number(values.maxRolls) },
      emptyWeight: Number(values.emptyWeight),
    };
    const result = await saveLootTable(table).catch(() => null);
    chatResultMsg(!!result, 'Loot table saved!', 'Error saving loot table');
    for (const warning of result?.warnings ?? []) {
      chatResultMsg(false, '', warning);
    }
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const remove = async () => {
    if (!selectedId) return;
    await deleteLootTable(selectedId);
    chatResultMsg(true, 'Loot table deleted!', 'Error deleting loot table');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  // Each row shows its odds, so a designer need not divide weights by hand.
  const totalWeight =
    watchedEntries.reduce((sum, r) => sum + (Number(r.weight) || 0), 0) +
    emptyWeight;

  // Only the two members the rows need, so one renderer serves both arrays
  // whose form types do not unify.
  const renderRows = (
    kind: 'guaranteed' | 'entries',
    fieldArray: {
      fields: { id: string }[];
      remove: (index: number) => void;
    },
  ) => (
    <>
      {fieldArray.fields.length === 0 && (
        <p style={emptyHint}>
          {kind === 'guaranteed'
            ? 'Nothing always drops. Click + Add for a quest key or boss trophy.'
            : 'No weighted entries. Click + Add to build a random pool.'}
        </p>
      )}
      {fieldArray.fields.map((f, i) => (
        <div key={f.id} style={entryRow}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <label style={label}>Item</label>
            <Controller
              control={control}
              name={`${kind}.${i}.itemId` as const}
              render={({ field }) => (
                <AsyncSelect<number>
                  loadOptions={loadItems}
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </div>
          {kind === 'guaranteed' ? (
            <div style={{ width: 80, flexShrink: 0 }}>
              <label style={label}>Chance</label>
              <input
                style={input}
                type="number"
                step={0.05}
                min={0}
                max={1}
                {...register(`guaranteed.${i}.chance`, { setValueAs: Number })}
              />
            </div>
          ) : (
            <div style={{ width: 80, flexShrink: 0 }}>
              <label style={label}>Weight</label>
              <input
                style={input}
                type="number"
                min={0}
                {...register(`entries.${i}.weight`, { setValueAs: Number })}
              />
            </div>
          )}
          <div style={{ width: 62, flexShrink: 0 }}>
            <label style={label}>Min</label>
            <input
              style={input}
              type="number"
              min={1}
              {...register(`${kind}.${i}.minQty` as const, {
                setValueAs: Number,
              })}
            />
          </div>
          <div style={{ width: 62, flexShrink: 0 }}>
            <label style={label}>Max</label>
            <input
              style={input}
              type="number"
              min={1}
              {...register(`${kind}.${i}.maxQty` as const, {
                setValueAs: Number,
              })}
            />
          </div>
          <div style={{ width: 110, flexShrink: 0 }}>
            <label
              style={label}
              title="Name of a condition a script registered with provide('lootCondition.<name>'). Leave empty to always allow. An entry whose condition says no is removed before the roll, so it does not take odds from the pool."
            >
              Condition
            </label>
            <input
              style={input}
              type="text"
              placeholder="none"
              {...register(`${kind}.${i}.condition` as const)}
            />
          </div>
          {kind === 'entries' && (
            <span style={odds}>
              {totalWeight > 0
                ? `${(((Number(watchedEntries[i]?.weight) || 0) / totalWeight) * 100).toFixed(1)}%`
                : '-'}
            </span>
          )}
          <button
            type="button"
            style={removeBtn}
            onClick={() => fieldArray.remove(i)}
            title="Remove"
          >
            ✕
          </button>
        </div>
      ))}
    </>
  );

  return (
    <form style={container} onSubmit={handleSubmit(save)}>
      <div style={field}>
        <label style={label}>Loot table</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadTables}
              value={selectedId}
              onChange={(id) => void selectTable(id)}
            />
          </div>
          {selectedId && (
            <button type="button" style={ghostBtn} onClick={() => void reset()}>
              New
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={field}>
          <label style={label}>ID</label>
          <input
            style={{ ...input, ...(selectedId ? { opacity: 0.5 } : {}) }}
            {...register('id')}
            placeholder="goblin-tier1"
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>Name</label>
          <input
            style={input}
            {...register('name')}
            placeholder="Goblin (tier 1)"
          />
        </div>
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>Always drops</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => guaranteed.append(newRow())}
          >
            + Add
          </button>
        </div>
        {renderRows('guaranteed', guaranteed)}
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>Random pool</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => entries.append(newRow())}
          >
            + Add
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ width: 72 }}>
            <label style={label}>Min rolls</label>
            <input
              style={input}
              type="number"
              min={0}
              {...register('minRolls', { setValueAs: Number })}
            />
          </div>
          <div style={{ width: 72 }}>
            <label style={label}>Max rolls</label>
            <input
              style={input}
              type="number"
              min={0}
              {...register('maxRolls', { setValueAs: Number })}
            />
          </div>
          <div style={{ width: 96 }}>
            <label style={label} title="Weight of drawing nothing at all">
              Nothing
            </label>
            <input
              style={input}
              type="number"
              min={0}
              {...register('emptyWeight', { setValueAs: Number })}
            />
          </div>
          {emptyWeight > 0 && totalWeight > 0 && (
            <span style={odds}>
              {((emptyWeight / totalWeight) * 100).toFixed(1)}% nothing
            </span>
          )}
        </div>

        {renderRows('entries', entries)}
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? 'Save table' : 'Create table'}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={() => void remove()}>
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
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  background: colors.surface,
};
const box: React.CSSProperties = {
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const boxHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const entryRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
};
const odds: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
  whiteSpace: 'nowrap',
  paddingBottom: 8,
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
const ghostBtn: React.CSSProperties = {
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
const removeBtn: React.CSSProperties = {
  background: 'transparent',
  color: colors.textMuted,
  border: 'none',
  padding: '0 4px',
  cursor: 'pointer',
  fontSize: 14,
  alignSelf: 'flex-end',
  paddingBottom: 8,
};
