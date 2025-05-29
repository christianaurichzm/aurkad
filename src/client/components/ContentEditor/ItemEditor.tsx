import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Item } from '../../../shared/types';
import { drawItemGeneric } from '../../graphics/render';
import { updateItem, createItem, deleteItem } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { ItemIcon } from '../Inventory/ItemIcon';

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
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const reset = () => {
    setSelectedId('');
    setName('');
    setSprite(0);
    setDesc('');
    setType('helmet');
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
  ];

  return (
    <div style={styles.group}>
      <h3 style={styles.h3}>Item Editor</h3>
      <label style={styles.label}>Selecione Item</label>
      <AsyncSelect<Item['id']>
        loadOptions={loadItems}
        value={selectedId ? Number(selectedId) : 0}
        onChange={selectItem}
      />
      <label style={styles.label}>Name</label>
      <input
        style={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
      />
      <label style={styles.label}>Sprite ID</label>
      <input
        style={styles.input}
        type="number"
        value={sprite}
        onChange={(e) => setSprite(+e.target.value)}
        placeholder="Sprite ID"
      />
      <label style={styles.label}>Preview</label>
      <ItemIcon
        spriteId={sprite}
        style={{
          border: '1px solid #ccc',
          marginBottom: 8,
          width: 64,
          height: 64,
        }}
      />
      <label style={styles.label}>Description</label>
      <input
        style={styles.input}
        value={desc}
        onChange={(e) => setDesc(e.target.value)}
        placeholder="Description"
      />
      <label style={styles.label}>Type</label>
      <AsyncSelect
        loadOptions={async () => typeOptions}
        value={type}
        onChange={(v) => setType(v as Item['type'])}
      />
      <div style={styles.actions}>
        <button style={styles.btn} onClick={saveItem}>
          Save Item
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnDanger }}
          onClick={removeItem}
        >
          Delete Item
        </button>
      </div>
    </div>
  );
};

const styles = {
  group: {
    background: '#f9f9f9',
    borderRadius: 12,
    padding: '18px 15px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 12,
    border: '1px solid #e9fbe9',
  },
  h3: {
    margin: 0,
    marginBottom: 5,
    color: '#333',
    fontWeight: 700,
    fontSize: '1rem',
    textAlign: 'left' as const,
  },
  label: {
    fontWeight: 600,
    color: '#218c49',
    fontSize: 14,
    marginBottom: 2,
    display: 'block' as const,
  },
  input: {
    width: '100%',
    padding: '9px 10px',
    border: '1.5px solid #a0e0a0',
    borderRadius: 6,
    outline: 'none',
    fontSize: 14,
    background: '#fff',
    marginBottom: 5,
    transition: 'border 0.16s, background 0.16s',
  },
  canvas: {
    border: '1px solid #ccc',
    marginBottom: 8,
    height: '64px',
    width: '64px',
  },
  actions: {
    display: 'flex' as const,
    gap: 10,
    marginTop: 5,
  },
  btn: {
    background: '#2ecc40',
    color: '#fff',
    border: 'none',
    padding: '9px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    transition: 'background 0.2s',
    flexGrow: 1,
    textAlign: 'center' as const,
  },
  btnDanger: {
    background: '#e74c3c',
  },
};
