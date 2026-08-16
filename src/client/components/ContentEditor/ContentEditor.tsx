import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ItemEditor } from './ItemEditor';
import { NpcEditor } from './NpcEditor';
import { MapEditor } from './MapEditor';
import { ShopEditor } from './ShopEditor';
import { SpellEditor } from './SpellEditor';
import { ArrowEditor } from './ArrowEditor';
import { LootTableEditor } from './LootTableEditor';
import { DialogEditor } from './DialogEditor';
import { QuestEditor } from './QuestEditor';
import { RecipeEditor } from './RecipeEditor';
import {
  RuntimeNpc,
  Item,
  MapStateClient,
  Shop,
  ProductRaw,
  LootTable,
  Dialog,
  Quest,
  Recipe,
} from '../../../shared/types';
import {
  fetchNpcs,
  fetchItems,
  fetchMaps,
  fetchShops,
  listLootTables,
  listDialogs,
  listQuests,
  listRecipes,
} from '../../io/network';
import { Modal } from '../common/Modal';
import { colors, radius } from '../../theme';
import { useUIStore } from '../../stores/uiStore';

type Tab =
  | 'npcs'
  | 'items'
  | 'loot'
  | 'dialogs'
  | 'quests'
  | 'recipes'
  | 'shops'
  | 'maps'
  | 'spells'
  | 'arrows';

export const ContentEditor: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<Tab>('npcs');
  const [npcs, setNpcs] = useState<RuntimeNpc[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [shops, setShops] = useState<Shop<ProductRaw>[]>([]);
  const [maps, setMaps] = useState<MapStateClient[]>([]);
  const [lootTables, setLootTables] = useState<LootTable[]>([]);
  const [dialogs, setDialogs] = useState<Dialog[]>([]);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [contentDirty, setContentDirty] = useState(false);
  const visibleRef = useRef(false);
  const dirtyRef = useRef(false);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);
  useEffect(() => {
    dirtyRef.current = contentDirty;
  }, [contentDirty]);

  const confirmDiscard = useCallback(async () => {
    if (!dirtyRef.current) return true;
    const discard = await useUIStore.getState().showDialog({
      title: 'Discard changes?',
      message: 'You have unsaved editor changes. Discard them?',
      kind: 'confirm',
      confirmLabel: 'Discard',
      cancelLabel: 'Keep editing',
    });
    if (discard) setContentDirty(false);
    return discard;
  }, []);

  const close = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    setContentDirty(false);
    setVisible(false);
  }, [confirmDiscard]);

  useEffect(() => {
    const toggle = () => {
      if (visibleRef.current) void close();
      else setVisible(true);
    };
    window.addEventListener('toggleContentEditor', toggle);
    return () => window.removeEventListener('toggleContentEditor', toggle);
  }, [close]);

  const refreshData = useCallback(async () => {
    const [
      npcData,
      itemData,
      shopData,
      mapData,
      lootData,
      dialogData,
      questData,
      recipeData,
    ] = await Promise.all([
      fetchNpcs(),
      fetchItems(),
      fetchShops(),
      fetchMaps(),
      listLootTables(),
      listDialogs(),
      listQuests(),
      listRecipes(),
    ]);
    setNpcs(npcData);
    setItems(itemData);
    setShops(shopData);
    setMaps(mapData);
    setLootTables(lootData);
    setDialogs(dialogData);
    setQuests(questData);
    setRecipes(recipeData);
  }, []);

  useEffect(() => {
    if (visible) void refreshData();
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

  const loadShops = useCallback(async () => {
    const data = await fetchShops();
    setShops(data);
    return data.map((s) => ({ value: s.id, label: `${s.id} - ${s.name}` }));
  }, []);

  const loadLootTables = useCallback(async () => {
    const data = await listLootTables();
    setLootTables(data);
    return data.map((t) => ({ value: t.id, label: `${t.id} - ${t.name}` }));
  }, []);

  const loadDialogs = useCallback(async () => {
    const data = await listDialogs();
    setDialogs(data);
    return data.map((d) => ({ value: d.id, label: `${d.id} - ${d.name}` }));
  }, []);

  const loadQuests = useCallback(async () => {
    const data = await listQuests();
    setQuests(data);
    return data.map((q) => ({ value: q.id, label: `${q.id} - ${q.name}` }));
  }, []);

  const loadRecipes = useCallback(async () => {
    const data = await listRecipes();
    setRecipes(data);
    return data.map((r) => ({ value: r.id, label: `${r.id} - ${r.name}` }));
  }, []);

  const loadMaps = useCallback(async () => {
    const data = await fetchMaps();
    setMaps(data);
    return data.map((m) => ({ value: m.id, label: `${m.id} - ${m.name}` }));
  }, []);

  if (!visible) return null;

  const selectTab = async (nextTab: Tab) => {
    if (nextTab === tab) return;
    if (!(await confirmDiscard())) return;
    setTab(nextTab);
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'npcs', label: 'NPCs' },
    { id: 'items', label: 'Items' },
    { id: 'loot', label: 'Loot' },
    { id: 'dialogs', label: 'Dialogs' },
    { id: 'quests', label: 'Quests' },
    { id: 'recipes', label: 'Recipes' },
    { id: 'shops', label: 'Shops' },
    { id: 'maps', label: 'Maps' },
    { id: 'spells', label: 'Spells' },
    { id: 'arrows', label: 'Arrows' },
  ];

  return (
    <Modal title="Content Editor" onClose={close} width={580}>
      <div style={layout}>
        <div style={tabBar}>
          {tabs.map((t) => (
            <button
              key={t.id}
              style={{ ...tabBtn, ...(tab === t.id ? tabBtnActive : {}) }}
              onClick={() => void selectTab(t.id)}
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
              loadLootTables={loadLootTables}
              loadDialogs={loadDialogs}
              loadQuests={loadQuests}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'items' && (
            <ItemEditor
              items={items}
              loadItems={loadItems}
              refreshData={refreshData}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'loot' && (
            <LootTableEditor
              tables={lootTables}
              loadTables={loadLootTables}
              loadItems={loadItems}
              refreshData={refreshData}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'dialogs' && (
            <DialogEditor
              dialogs={dialogs}
              loadDialogs={loadDialogs}
              refreshData={refreshData}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'quests' && (
            <QuestEditor
              quests={quests}
              loadQuests={loadQuests}
              loadNpcs={loadNpcs}
              loadItems={loadItems}
              loadMaps={loadMaps}
              refreshData={refreshData}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'recipes' && (
            <RecipeEditor
              recipes={recipes}
              loadRecipes={loadRecipes}
              loadItems={loadItems}
              refreshData={refreshData}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'shops' && (
            <ShopEditor
              shops={shops}
              items={items}
              loadShops={loadShops}
              loadItems={loadItems}
              refreshData={refreshData}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'maps' && (
            <MapEditor
              maps={maps}
              loadMaps={loadMaps}
              refreshData={refreshData}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'spells' && (
            <SpellEditor
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'arrows' && (
            <ArrowEditor
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
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
  padding: '8px 18px',
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
