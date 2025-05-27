import React, { useCallback, useEffect, useState } from 'react';
import { ItemEditor } from './ItemEditor';
import { RuntimeNpc, Item } from '../../../shared/types';
import { fetchNpcs, fetchItems } from '../../io/network';
import { NpcEditor } from './NpcEditor';

export const ContentEditor: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [npcs, setNpcs] = useState<RuntimeNpc[]>([]);
  const [items, setItems] = useState<Item[]>([]);

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    window.addEventListener('toggleContentEditor', toggle);
    return () => window.removeEventListener('toggleContentEditor', toggle);
  }, []);

  const refreshData = useCallback(() => {
    fetchNpcs().then(setNpcs);
    fetchItems().then(setItems);
  }, []);

  const loadNpcs = useCallback(async () => {
    const data = await fetchNpcs();
    setNpcs(data);
    return data.map((n) => ({ value: n.id, label: `${n.id} - ${n.name}` }));
  }, []);

  const loadItems = useCallback(async () => {
    const data = await fetchItems();
    setItems(data);
    return data.map((i) => ({ value: i.id, label: `${i.id} - ${i.name}` }));
  }, []);

  if (!visible) return null;

  return (
    <div style={styles.container}>
      <button style={styles.closeBtn} onClick={() => setVisible(false)}>
        x
      </button>
      <h2 style={styles.title}>Content Editor</h2>
      <NpcEditor npcs={npcs} loadNpcs={loadNpcs} refreshData={refreshData} />
      <ItemEditor
        items={items}
        loadItems={loadItems}
        refreshData={refreshData}
      />
    </div>
  );
};

const styles = {
  container: {
    position: 'absolute' as const,
    top: 15,
    right: 15,
    background: '#fff',
    border: '2px solid #2ecc40',
    borderRadius: 16,
    boxShadow: '0 5px 25px rgba(0,0,0,0.3)',
    padding: '25px 20px',
    width: 400,
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 20,
    zIndex: 150,
  },
  closeBtn: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    background: 'transparent',
    border: 'none',
    fontSize: '1.2rem',
    cursor: 'pointer',
  },
  title: {
    margin: 0,
    color: '#16913c',
    fontWeight: 700,
    textAlign: 'center' as const,
    fontSize: '1.4rem',
  },
};
