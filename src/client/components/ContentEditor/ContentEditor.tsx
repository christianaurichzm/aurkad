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
  listModules,
} from '../../io/network';
import { Modal } from '../common/Modal';
import { useUIStore } from '../../stores/uiStore';
import { useT, type TranslationKey } from '../../i18n';

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

// Tabs whose content only means something while the module that runs it is
// loaded; every other tab is core.
const MODULE_TABS: Partial<Record<Tab, string>> = {
  dialogs: 'dialog',
  quests: 'quest',
  recipes: 'crafting',
  spells: 'magic',
  arrows: 'archery',
};

export const ContentEditor: React.FC = () => {
  const t = useT();
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
  const [modules, setModules] = useState<string[]>([]);
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
      title: t('editor.discardTitle'),
      message: t('editor.discardMessage'),
      kind: 'confirm',
      confirmLabel: t('editor.discard'),
      cancelLabel: t('editor.keepEditing'),
    });
    if (discard) setContentDirty(false);
    return discard;
  }, [t]);

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
      moduleIds,
    ] = await Promise.all([
      fetchNpcs(),
      fetchItems(),
      fetchShops(),
      fetchMaps(),
      listLootTables(),
      listDialogs(),
      listQuests(),
      listRecipes(),
      listModules(),
    ]);
    setNpcs(npcData);
    setItems(itemData);
    setShops(shopData);
    setMaps(mapData);
    setLootTables(lootData);
    setDialogs(dialogData);
    setQuests(questData);
    setRecipes(recipeData);
    setModules(moduleIds);
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

  const allTabs: { id: Tab; label: TranslationKey }[] = [
    { id: 'npcs', label: 'editor.tabNpcs' },
    { id: 'items', label: 'editor.tabItems' },
    { id: 'loot', label: 'editor.tabLoot' },
    { id: 'dialogs', label: 'editor.tabDialogs' },
    { id: 'quests', label: 'editor.tabQuests' },
    { id: 'recipes', label: 'editor.tabRecipes' },
    { id: 'shops', label: 'editor.tabShops' },
    { id: 'maps', label: 'editor.tabMaps' },
    { id: 'spells', label: 'editor.tabSpells' },
    { id: 'arrows', label: 'editor.tabArrows' },
  ];
  const tabs = allTabs.filter(({ id }) => {
    const module = MODULE_TABS[id];
    return !module || modules.includes(module);
  });

  return (
    <Modal title={t('editor.contentTitle')} onClose={close} width={880}>
      <div className="content-workspace">
        <nav
          className="content-navigation"
          aria-label={t('editor.contentTitle')}
        >
          {tabs.map((entry) => (
            <button
              key={entry.id}
              className="content-tab"
              aria-pressed={tab === entry.id}
              onClick={() => void selectTab(entry.id)}
            >
              {t(entry.label)}
            </button>
          ))}
        </nav>
        <div className="content-inspector">
          <h3 className="inspector-title">
            {t(tabs.find((entry) => entry.id === tab)!.label)}
          </h3>
          {tab === 'npcs' && (
            <NpcEditor
              npcs={npcs}
              loadNpcs={loadNpcs}
              refreshData={refreshData}
              loadItems={loadItems}
              loadLootTables={loadLootTables}
              loadDialogs={loadDialogs}
              loadQuests={loadQuests}
              modules={modules}
              onDirtyChange={setContentDirty}
              requestDiscard={confirmDiscard}
            />
          )}
          {tab === 'items' && (
            <ItemEditor
              items={items}
              loadItems={loadItems}
              refreshData={refreshData}
              modules={modules}
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
