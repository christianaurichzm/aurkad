import React from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Item, ProductRaw, Shop } from '../../../shared/types';
import { createShop, updateShop, deleteShop } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { editorStyles } from '../../theme';
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

interface ShopEditorProps extends EditorGuardProps {
  shops: Shop<ProductRaw>[];
  items: Item[];
  loadShops: () => Promise<{ value: string; label: string }[]>;
  loadItems: () => Promise<{ value: number; label: string }[]>;
  refreshData: () => void;
}

type ProductRow = { itemId: number; currency: number; price: number };
type ShopFormValues = { id: string; name: string; products: ProductRow[] };

const defaultValues: ShopFormValues = { id: '', name: '', products: [] };

const shopToForm = (shop: Shop<ProductRaw>): ShopFormValues => ({
  id: shop.id,
  name: shop.name,
  products: shop.products.map((p) => ({
    itemId: p.itemId,
    currency: p.currency,
    price: p.price,
  })),
});

export const ShopEditor: React.FC<ShopEditorProps> = ({
  shops,
  loadShops,
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
  } = useForm<ShopFormValues>({ defaultValues });
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'products',
  });

  const { selectedId, clear, open, startNew } = useEntrySelection(
    isDirty,
    guard,
    () => resetForm(defaultValues),
  );

  const selectShop = async (id: string) => {
    if (!(await open(id))) return;
    const shop = shops.find((s) => s.id === id);
    if (shop) resetForm(shopToForm(shop));
  };

  const saveShop = async ({ id, name, products }: ShopFormValues) => {
    const ok = selectedId
      ? await updateShop(selectedId, { id, name, products })
          .then(() => true)
          .catch(() => false)
      : await createShop({ id, name, products })
          .then((r) => !!r)
          .catch(() => false);
    chatResultMsg(ok, t('shopEditor.saved'), t('shopEditor.saveError'));
    refreshData();
    clear();
  };

  const removeShop = async () => {
    if (!selectedId) return;
    await deleteShop(selectedId);
    chatResultMsg(true, t('shopEditor.deleted'), t('shopEditor.deleteError'));
    refreshData();
    clear();
  };

  return (
    <form style={container} onSubmit={handleSubmit(saveShop)}>
      <div style={field}>
        <label style={label}>{t('shopEditor.shop')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadShops}
              value={selectedId}
              onChange={(id) => void selectShop(id)}
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
            placeholder={t('shopEditor.idPlaceholder')}
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('editor.name')}</label>
          <input
            style={input}
            {...register('name')}
            placeholder={t('shopEditor.namePlaceholder')}
          />
        </div>
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>{t('shopEditor.products')}</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => append({ itemId: 0, currency: 0, price: 1 })}
          >
            {t('editor.add')}
          </button>
        </div>

        {fields.length === 0 && (
          <p style={emptyHint}>{t('shopEditor.noProducts')}</p>
        )}

        {fields.map((f, i) => (
          <div key={f.id} style={entryRow}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <label style={label}>{t('item.item')}</label>
              <Controller
                control={control}
                name={`products.${i}.itemId`}
                render={({ field }) => (
                  <AsyncSelect<number>
                    loadOptions={loadItems}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            <div style={{ flex: 2, minWidth: 0 }}>
              <label style={label}>{t('shopEditor.currency')}</label>
              <Controller
                control={control}
                name={`products.${i}.currency`}
                render={({ field }) => (
                  <AsyncSelect<number>
                    loadOptions={loadItems}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
            </div>
            <div style={{ width: 72, flexShrink: 0 }}>
              <label style={label}>{t('shopEditor.price')}</label>
              <input
                style={input}
                type="number"
                min={1}
                {...register(`products.${i}.price`, { setValueAs: Number })}
              />
            </div>
            <button
              type="button"
              style={removeBtn}
              onClick={() => remove(i)}
              title={t('editor.remove')}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? t('shopEditor.save') : t('shopEditor.createBtn')}
        </button>
        {selectedId && (
          <button
            type="button"
            style={deleteBtn}
            onClick={() => void removeShop()}
          >
            {t('common.delete')}
          </button>
        )}
      </div>
    </form>
  );
};
