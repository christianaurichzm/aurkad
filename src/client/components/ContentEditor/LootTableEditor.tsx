import React from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { LootQuantity, LootTable } from '../../../shared/types';
import { saveLootTable, deleteLootTable } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { colors, editorStyles } from '../../theme';
import {
  useEntrySelection,
  type EditorGuardProps,
} from '../../hooks/useEntrySelection';
import { useT } from '../../i18n';

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

interface LootTableEditorProps extends EditorGuardProps {
  tables: LootTable[];
  loadTables: () => Promise<{ value: string; label: string }[]>;
  loadItems: () => Promise<{ value: number; label: string }[]>;
  refreshData: () => void;
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
  } = useForm<LootFormValues>({ defaultValues });

  const guaranteed = useFieldArray({ control, name: 'guaranteed' });
  const entries = useFieldArray({ control, name: 'entries' });
  const watchedEntries = watch('entries');
  const emptyWeight = Number(watch('emptyWeight')) || 0;

  const { selectedId, clear, open, startNew } = useEntrySelection(
    isDirty,
    guard,
    () => resetForm(defaultValues),
  );

  const selectTable = async (id: string) => {
    if (!(await open(id))) return;
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
    chatResultMsg(!!result, t('loot.saved'), t('loot.saveError'));
    for (const warning of result?.warnings ?? []) {
      chatResultMsg(false, '', warning);
    }
    if (!result) return;
    refreshData();
    clear();
  };

  const remove = async () => {
    if (!selectedId) return;
    const ok = await deleteLootTable(selectedId)
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, t('loot.deleted'), t('loot.deleteError'));
    if (!ok) return;
    refreshData();
    clear();
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
          {kind === 'guaranteed' ? t('loot.noGuaranteed') : t('loot.noEntries')}
        </p>
      )}
      {fieldArray.fields.map((f, i) => (
        <div key={f.id} style={entryRow}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <label style={label}>{t('item.item')}</label>
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
              <label style={label}>{t('loot.chance')}</label>
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
              <label style={label}>{t('loot.weight')}</label>
              <input
                style={input}
                type="number"
                min={0}
                {...register(`entries.${i}.weight`, { setValueAs: Number })}
              />
            </div>
          )}
          <div style={{ width: 62, flexShrink: 0 }}>
            <label style={label}>{t('loot.min')}</label>
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
            <label style={label}>{t('loot.max')}</label>
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
            <label style={label} title={t('loot.conditionHelp')}>
              {t('loot.condition')}
            </label>
            <input
              style={input}
              type="text"
              placeholder={t('loot.conditionNone')}
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
            title={t('editor.remove')}
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
        <label style={label}>{t('npc.lootTable')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadTables}
              value={selectedId}
              onChange={(id) => void selectTable(id)}
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
            placeholder={t('loot.idPlaceholder')}
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('editor.name')}</label>
          <input
            style={input}
            {...register('name')}
            placeholder={t('loot.namePlaceholder')}
          />
        </div>
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>{t('loot.always')}</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => guaranteed.append(newRow())}
          >
            {t('editor.add')}
          </button>
        </div>
        {renderRows('guaranteed', guaranteed)}
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>{t('loot.pool')}</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => entries.append(newRow())}
          >
            {t('editor.add')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div style={{ width: 72 }}>
            <label style={label}>{t('loot.minRolls')}</label>
            <input
              style={input}
              type="number"
              min={0}
              {...register('minRolls', { setValueAs: Number })}
            />
          </div>
          <div style={{ width: 72 }}>
            <label style={label}>{t('loot.maxRolls')}</label>
            <input
              style={input}
              type="number"
              min={0}
              {...register('maxRolls', { setValueAs: Number })}
            />
          </div>
          <div style={{ width: 96 }}>
            <label style={label} title={t('loot.nothingHelp')}>
              {t('loot.nothing')}
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
              {t('loot.nothingOdds', {
                percent: ((emptyWeight / totalWeight) * 100).toFixed(1),
              })}
            </span>
          )}
        </div>

        {renderRows('entries', entries)}
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? t('loot.save') : t('loot.createBtn')}
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

const odds: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
  whiteSpace: 'nowrap',
  paddingBottom: 8,
};
