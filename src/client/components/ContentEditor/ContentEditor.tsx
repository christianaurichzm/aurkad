import React, { useCallback, useEffect, useState } from 'react';
import { ItemEditor } from './ItemEditor';
import { NpcEditor } from './NpcEditor';
import { MapEditor } from './MapEditor';

import { RuntimeNpc, Item, MapStateClient } from '../../../shared/types';
import { fetchNpcs, fetchItems, fetchMaps } from '../../io/network';
import { useGame } from '../../context/GameContext';
import { colors, radius, shadow, zIndex } from '../../theme';

export const ContentEditor: React.FC = () => {
  const { map: currentMap } = useGame();
  const [visible, setVisible] = useState(false);
  const [npcs, setNpcs] = useState<RuntimeNpc[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [maps, setMaps] = useState<MapStateClient[]>([]);

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    window.addEventListener('toggleContentEditor', toggle);
    return () => window.removeEventListener('toggleContentEditor', toggle);
  }, []);

  const refreshData = useCallback(() => {
    fetchNpcs().then(setNpcs);
    fetchItems().then(setItems);
    fetchMaps().then(setMaps);
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

  const loadMaps = useCallback(async () => {
    const data = await fetchMaps();
    const filteredMaps = data.filter((m) => m.id !== currentMap?.id);
    setMaps(filteredMaps);
    return filteredMaps.map((m) => ({
      value: m.id,
      label: `${m.id} - ${m.name}`,
    }));
  }, []);

  if (!visible) return null;

  return (
    <div style={styles.container}>
      <button style={styles.closeBtn} onClick={() => setVisible(false)}>
        x
      </button>
      <h2 style={styles.title}>Content Editor</h2>
      <NpcEditor
        npcs={npcs}
        loadNpcs={loadNpcs}
        refreshData={refreshData}
        items={items}
        loadItems={loadItems}
      />
      <ItemEditor
        items={items}
        loadItems={loadItems}
        refreshData={refreshData}
      />
      <MapEditor maps={maps} loadMaps={loadMaps} refreshData={refreshData} />
    </div>
  );
};

const styles = {
  container: {
    position: 'absolute' as const,
    top: 15,
    right: 15,
    background: colors.surface,
    border: `2px solid ${colors.primary}`,
    borderRadius: radius.lg,
    boxShadow: shadow.panel,
    padding: '25px 20px',
    width: 400,
    maxWidth: '95vw',
    maxHeight: '90vh',
    overflowY: 'auto' as const,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 20,
    zIndex: zIndex.panel,
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
    color: colors.primary,
    fontWeight: 700,
    textAlign: 'center' as const,
    fontSize: '1.4rem',
  },
};
