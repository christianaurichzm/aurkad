import React, { useState } from 'react';
import { Item } from '../../../shared/types';
import { updateItem, createItem, deleteItem } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { ItemIcon } from '../Inventory/ItemIcon';
import { colors, radius } from '../../theme';

interface ItemEditorProps {
  items: Item[];
  loadItems: () => Promise<any>;
  refreshData: () => void;
}

export const ItemEditor: React.FC<ItemEditorProps> = ({
  items,
  loadItems,
  refreshData,
}) => {
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [sprite, setSprite] = useState(0);
  const [desc, setDesc] = useState('');
  const [type, setType] = useState<Item['type']>('weapon');

  const reset = () => {
    setSelectedId('');
    setName('');
    setSprite(0);
    setDesc('');
    setType('weapon');
  };

  const selectItem = (id: number) => {
    setSelectedId(String(id));
    const item = items.find((i) => i.id === id);
    if (item) {
      setName(item.name);
      setSprite(item.sprite);
      setDesc(item.description ?? '');
      setType(item.type);
    }
  };

  const saveItem = async () => {
    const data = { name, sprite, description: desc, type };
    const result = selectedId
      ? await updateItem(Number(selectedId), data)
      : await createItem(data);
    chatResultMsg(!!result, 'Item saved!', 'Error saving item');
    refreshData();
    reset();
  };

  const removeItem = async () => {
    if (!selectedId) return;
    await deleteItem(Number(selectedId));
    chatResultMsg(true, 'Item deleted!', 'Error deleting item');
    refreshData();
    reset();
  };

  const typeOptions = [
    { value: 'weapon', label: 'Weapon' },
    { value: 'helmet', label: 'Helmet' },
    { value: 'chestplate', label: 'Chestplate' },
    { value: 'gloves', label: 'Gloves' },
    { value: 'boots', label: 'Boots' },
    { value: 'consumable', label: 'Consumable' },
    { value: 'money', label: 'Money' },
  ];

  return (
    <div style={container}>
      <div style={field}>
        <label style={label}>Item</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect<Item['id']>
              loadOptions={loadItems}
              value={selectedId ? Number(selectedId) : 0}
              onChange={selectItem}
            />
          </div>
          {selectedId && (
            <button style={resetBtn} onClick={reset}>
              New
            </button>
          )}
        </div>
      </div>

      <div style={cols}>
        <div style={leftCol}>
          <ItemIcon spriteId={sprite} style={previewIcon} />
          <div style={field}>
            <label style={label}>Sprite ID</label>
            <input
              style={input}
              type="number"
              value={sprite}
              onChange={(e) => setSprite(+e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div style={rightCol}>
          <div style={field}>
            <label style={label}>Name</label>
            <input
              style={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Item name"
            />
          </div>
          <div style={field}>
            <label style={label}>Type</label>
            <AsyncSelect
              loadOptions={async () => typeOptions}
              value={type}
              onChange={(v) => setType(v as Item['type'])}
            />
          </div>
          <div style={field}>
            <label style={label}>Description</label>
            <input
              style={input}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>
      </div>

      <div style={actions}>
        <button style={saveBtn} onClick={saveItem}>
          {selectedId ? 'Save Item' : 'Create Item'}
        </button>
        {selectedId && (
          <button style={deleteBtn} onClick={removeItem}>
            Delete
          </button>
        )}
      </div>
    </div>
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
