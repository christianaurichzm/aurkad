import React, { useCallback, useEffect, useState } from 'react';
import { ItemEditor } from './ItemEditor';
import { NpcEditor } from './NpcEditor';
import { MapEditor } from './MapEditor';
import { RuntimeNpc, Item, MapStateClient } from '../../../shared/types';
import { fetchNpcs, fetchItems, fetchMaps } from '../../io/network';
import { useGame } from '../../context/GameContext';
import { Modal } from '../common/Modal';
import { colors, radius } from '../../theme';

type Tab = 'npcs' | 'items' | 'maps';

export const ContentEditor: React.FC = () => {
  const { map: currentMap } = useGame();
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<Tab>('npcs');
  const [npcs, setNpcs] = useState<RuntimeNpc[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [maps, setMaps] = useState<MapStateClient[]>([]);

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    window.addEventListener('toggleContentEditor', toggle);
    return () => window.removeEventListener('toggleContentEditor', toggle);
  }, []);

  const filterMaps = useCallback(
    (data: MapStateClient[]) => data.filter((m) => m.id !== currentMap?.id),
    [currentMap?.id],
  );

  const refreshData = useCallback(async () => {
    const [npcData, itemData, mapData] = await Promise.all([
      fetchNpcs(),
      fetchItems(),
      fetchMaps(),
    ]);
    setNpcs(npcData);
    setItems(itemData);
    setMaps(filterMaps(mapData));
  }, [filterMaps]);

  useEffect(() => {
    if (visible) refreshData();
  }, [visible, refreshData]);

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
    const filtered = filterMaps(data);
    setMaps(filtered);
    return filtered.map((m) => ({ value: m.id, label: `${m.id} - ${m.name}` }));
  }, [filterMaps]);

  if (!visible) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'npcs', label: 'NPCs' },
    { id: 'items', label: 'Items' },
    { id: 'maps', label: 'Maps' },
  ];

  return (
    <Modal title="Content Editor" onClose={() => setVisible(false)} width={560}>
      <div style={layout}>
        <div style={tabBar}>
          {tabs.map((t) => (
            <button
              key={t.id}
              style={{ ...tabBtn, ...(tab === t.id ? tabBtnActive : {}) }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={tabContent}>
          {tab === 'npcs' && (
            <NpcEditor
              npcs={npcs}
              loadNpcs={loadNpcs}
              refreshData={refreshData}
              items={items}
              loadItems={loadItems}
            />
          )}
          {tab === 'items' && (
            <ItemEditor
              items={items}
              loadItems={loadItems}
              refreshData={refreshData}
            />
          )}
          {tab === 'maps' && (
            <MapEditor
              maps={maps}
              loadMaps={loadMaps}
              refreshData={refreshData}
            />
          )}
        </div>
      </div>
    </Modal>
  );
};

const layout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
};

const tabBar: React.CSSProperties = {
  display: 'flex',
  gap: 2,
  borderBottom: `1px solid ${colors.border}`,
  marginBottom: 20,
};

const tabBtn: React.CSSProperties = {
  padding: '8px 22px',
  border: 'none',
  background: 'transparent',
  color: colors.textMuted,
  fontWeight: 600,
  fontSize: 14,
  cursor: 'pointer',
  paddingBottom: 10,
  marginBottom: -1,
  borderBottom: '2px solid transparent',
  borderRadius: `${radius.sm}px ${radius.sm}px 0 0`,
};

const tabBtnActive: React.CSSProperties = {
  color: colors.primary,
  borderBottom: `2px solid ${colors.primary}`,
};

const tabContent: React.CSSProperties = { minHeight: 300 };
