import React from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Recipe } from '../../../shared/types';
import { saveRecipe, deleteRecipe } from '../../io/network';
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
  actions,
  saveBtn,
  deleteBtn,
  ghostBtn,
  addBtn,
  removeBtn,
} = editorStyles;

interface RecipeEditorProps extends EditorGuardProps {
  recipes: Recipe[];
  loadRecipes: () => Promise<{ value: string; label: string }[]>;
  loadItems: () => Promise<{ value: number; label: string }[]>;
  refreshData: () => void;
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
  } = useForm<RecipeFormValues>({ defaultValues });

  const inputs = useFieldArray({ control, name: 'inputs' });
  const watchedInputs = watch('inputs');

  const { selectedId, clear, open, startNew } = useEntrySelection(
    isDirty,
    guard,
    () => resetForm(defaultValues),
  );

  const selectRecipe = async (id: string) => {
    if (!(await open(id))) return;
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
    if (!result) return;
    refreshData();
    clear();
  };

  const remove = async () => {
    if (!selectedId) return;
    const ok = await deleteRecipe(selectedId)
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, t('recipe.deleted'), t('recipe.deleteError'));
    if (!ok) return;
    refreshData();
    clear();
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

const hint: React.CSSProperties = {
  fontSize: 12,
  color: colors.dangerText,
  whiteSpace: 'nowrap',
  paddingBottom: 8,
};
