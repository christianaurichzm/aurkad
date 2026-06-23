import React, { useEffect, useState } from 'react';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { Item, ProductRaw, Shop } from '../../../shared/types';
import { createShop, updateShop, deleteShop } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { colors, radius } from '../../theme';

interface ShopEditorProps {
  shops: Shop<ProductRaw>[];
  items: Item[];
  loadShops: () => Promise<{ value: string; label: string }[]>;
  loadItems: () => Promise<{ value: number; label: string }[]>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
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
  } = useForm<ShopFormValues>({ defaultValues });
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'products',
  });

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

  const selectShop = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
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
    chatResultMsg(ok, 'Shop saved!', 'Error saving shop');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const removeShop = async () => {
    if (!selectedId) return;
    await deleteShop(selectedId);
    chatResultMsg(true, 'Shop deleted!', 'Error deleting shop');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  return (
    <form style={container} onSubmit={handleSubmit(saveShop)}>
      <div style={field}>
        <label style={label}>Shop</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadShops}
              value={selectedId}
              onChange={(id) => void selectShop(id)}
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
            placeholder="general"
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>Name</label>
          <input
            style={input}
            {...register('name')}
            placeholder="General Store"
          />
        </div>
      </div>

      <div style={productsBox}>
        <div style={productsHeader}>
          <span style={label}>Products</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => append({ itemId: 0, currency: 0, price: 1 })}
          >
            + Add
          </button>
        </div>

        {fields.length === 0 && (
          <p style={emptyHint}>No products yet. Click + Add to add one.</p>
        )}

        {fields.map((f, i) => (
          <div key={f.id} style={productRow}>
            <div style={{ flex: 2, minWidth: 0 }}>
              <label style={label}>Item</label>
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
              <label style={label}>Currency item</label>
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
              <label style={label}>Price</label>
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
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? 'Save Shop' : 'Create Shop'}
        </button>
        {selectedId && (
          <button
            type="button"
            style={deleteBtn}
            onClick={() => void removeShop()}
          >
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

const productsBox: React.CSSProperties = {
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const productsHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const productRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
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
