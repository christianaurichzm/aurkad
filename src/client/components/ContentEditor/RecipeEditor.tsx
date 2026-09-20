import React, { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Recipe } from '../../../shared/types';
import { saveRecipe, deleteRecipe } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

interface RecipeEditorProps {
  recipes: Recipe[];
  loadRecipes: () => Promise<{ value: string; label: string }[]>;
  loadItems: () => Promise<{ value: number; label: string }[]>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

type IngredientRow = { itemId: number; quantity: number };

type RecipeFormValues = {
  id: string;
  name: string;
  inputs: IngredientRow[];
  outputItemId: number;
  outputQuantity: number;
  /** Empty means always available; see the field's help text below. */
  condition: string;
};

// One input row to start with, since the server refuses an empty list.
const defaultValues: RecipeFormValues = {
  id: '',
  name: '',
  inputs: [{ itemId: 0, quantity: 1 }],
  outputItemId: 0,
  outputQuantity: 1,
  condition: '',
};

const recipeToForm = (recipe: Recipe): RecipeFormValues => ({
  id: recipe.id,
  name: recipe.name,
  inputs: recipe.inputs.map((i) => ({
    itemId: i.itemId,
    quantity: i.quantity,
  })),
  outputItemId: recipe.output.itemId,
  outputQuantity: recipe.output.quantity,
  condition: recipe.condition ?? '',
});

export const RecipeEditor: React.FC<RecipeEditorProps> = ({
  recipes,
  loadRecipes,
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
    watch,
  } = useForm<RecipeFormValues>({ defaultValues });

  const inputs = useFieldArray({ control, name: 'inputs' });
  const watchedInputs = watch('inputs');

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

  const selectRecipe = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
    const recipe = recipes.find((r) => r.id === id);
    if (recipe) resetForm(recipeToForm(recipe));
  };

  const save = async (values: RecipeFormValues) => {
    const recipe: Recipe = {
      id: values.id,
      name: values.name,
      inputs: values.inputs.map((row) => ({
        itemId: Number(row.itemId),
        quantity: Number(row.quantity),
      })),
      output: {
        itemId: Number(values.outputItemId),
        quantity: Number(values.outputQuantity),
      },
      // Omitted when empty, so an unconditional recipe stores no condition.
      ...(values.condition.trim()
        ? { condition: values.condition.trim() }
        : {}),
    };
    const result = await saveRecipe(recipe).catch(() => null);
    chatResultMsg(!!result, t('recipe.saved'), t('recipe.saveError'));
    for (const warning of result?.warnings ?? []) {
      chatResultMsg(false, '', warning);
    }
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const remove = async () => {
    if (!selectedId) return;
    await deleteRecipe(selectedId);
    chatResultMsg(true, t('recipe.deleted'), t('recipe.deleteError'));
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  // The server warns about repeated items on save; saying it here answers
  // before the round trip.
  const duplicated = new Set(
    watchedInputs
      .map((row) => Number(row.itemId))
      .filter((id, i, all) => all.indexOf(id) !== i),
  );

  return (
    <form style={container} onSubmit={handleSubmit(save)}>
      <div style={field}>
        <label style={label}>{t('recipe.recipe')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadRecipes}
              value={selectedId}
              onChange={(id) => void selectRecipe(id)}
            />
          </div>
          {selectedId && (
            <button type="button" style={ghostBtn} onClick={() => void reset()}>
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
            placeholder={t('recipe.idPlaceholder')}
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('editor.name')}</label>
          <input
            style={input}
            {...register('name')}
            placeholder={t('recipe.namePlaceholder')}
          />
        </div>
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>{t('recipe.consumes')}</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => inputs.append({ itemId: 0, quantity: 1 })}
          >
            {t('editor.add')}
          </button>
        </div>
        {inputs.fields.map((f, i) => (
          <div key={f.id} style={entryRow}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <label style={label}>{t('item.item')}</label>
              <Controller
                control={control}
                name={`inputs.${i}.itemId` as const}
                render={({ field: c }) => (
                  <AsyncSelect<number>
                    loadOptions={loadItems}
                    value={c.value}
                    onChange={c.onChange}
                  />
                )}
              />
            </div>
            <div style={{ width: 80, flexShrink: 0 }}>
              <label style={label}>{t('npc.qty')}</label>
              <input
                style={input}
                type="number"
                min={1}
                {...register(`inputs.${i}.quantity` as const, {
                  setValueAs: Number,
                })}
              />
            </div>
            {duplicated.has(Number(watchedInputs[i]?.itemId)) && (
              <span style={hint} title={t('recipe.duplicateHelp')}>
                {t('recipe.duplicate')}
              </span>
            )}
            {/* The last input cannot go: a recipe consuming nothing prints
                items, which is what the server refuses on the way in. */}
            {inputs.fields.length > 1 && (
              <button
                type="button"
                style={removeBtn}
                onClick={() => inputs.remove(i)}
                title={t('editor.remove')}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      <div style={box}>
        <span style={label}>{t('recipe.produces')}</span>
        <div style={entryRow}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <label style={label}>{t('item.item')}</label>
            <Controller
              control={control}
              name="outputItemId"
              render={({ field: c }) => (
                <AsyncSelect<number>
                  loadOptions={loadItems}
                  value={c.value}
                  onChange={c.onChange}
                />
              )}
            />
          </div>
          <div style={{ width: 80, flexShrink: 0 }}>
            <label style={label}>{t('npc.qty')}</label>
            <input
              style={input}
              type="number"
              min={1}
              {...register('outputQuantity', { setValueAs: Number })}
            />
          </div>
        </div>
      </div>

      <div style={field}>
        <label style={label} title={t('recipe.conditionHelp')}>
          {t('loot.condition')}
        </label>
        <input
          style={input}
          type="text"
          placeholder={t('loot.conditionNone')}
          {...register('condition')}
        />
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? t('recipe.save') : t('recipe.createBtn')}
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
const hint: React.CSSProperties = {
  fontSize: 12,
  color: colors.dangerText,
  whiteSpace: 'nowrap',
  paddingBottom: 8,
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
  color: colors.info,
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
