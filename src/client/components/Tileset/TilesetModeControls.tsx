import React, { useEffect, useState } from 'react';
import {
  mapEdited,
  saveCurrentMap,
  toggleBlocking,
  toggleWarping,
  toggleNpc,
  toggleItem,
  toggleShop,
} from '../../graphics/tileset';
import { fetchNpcs, fetchItems, fetchShops } from '../../io/network';
import { AsyncSelect } from '../common/Select/AsyncSelect';

type ModeKey = 'blocking' | 'warping' | 'npc' | 'item' | 'shop';

export const TilesetModeControls: React.FC = () => {
  const [activeMode, setActiveMode] = useState<ModeKey | null>(null);

  const [selectedNpc, setSelectedNpc] = useState<string | number>('');
  const [selectedItem, setSelectedItem] = useState<string | number>('');
  const [selectedShop, setSelectedShop] = useState<string | number>('');

  useEffect(() => {
    (window as any).selectedNpc = selectedNpc;
  }, [selectedNpc]);

  useEffect(() => {
    (window as any).selectedItem = selectedItem;
  }, [selectedItem]);

  useEffect(() => {
    (window as any).selectedShop = selectedShop;
  }, [selectedShop]);

  const loadNpcs = async () => {
    const npcs = await fetchNpcs();
    return npcs.map((n) => ({ value: n.id, label: `${n.id} - ${n.name}` }));
  };

  const loadItems = async () => {
    const items = await fetchItems();
    return items.map((i) => ({ value: i.id, label: `${i.id} - ${i.name}` }));
  };

  const loadShops = async () => {
    const shops = await fetchShops();
    return shops.map((s) => ({ value: s.id, label: `${s.id} - ${s.name}` }));
  };

  const handleSave = async () => {
    if (!mapEdited) return;
    if (confirm('You have unsaved changes. Save now?')) {
      await saveCurrentMap();
    }
  };

  const handleToggle = (mode: ModeKey) => {
    const newMode = activeMode === mode ? null : mode;
    setActiveMode(newMode);

    switch (mode) {
      case 'blocking':
        toggleBlocking();
        break;
      case 'warping':
        toggleWarping();
        break;
      case 'npc':
        toggleNpc();
        break;
      case 'item':
        toggleItem();
        break;
      case 'shop':
        toggleShop();
        break;
    }
  };

  return (
    <div className="tileset-controls">
      <button className="editor-btn save-btn" onClick={handleSave}>
        Save Map
      </button>

      <div className="mode-controls">
        <div
          className={`mode-group ${activeMode === 'blocking' ? 'active' : ''}`}
        >
          <button
            className={`editor-btn small ${activeMode === 'blocking' ? 'active' : ''}`}
            onClick={() => handleToggle('blocking')}
          >
            Blocking Mode: {activeMode === 'blocking' ? 'ON' : 'OFF'}
          </button>
        </div>

        <div
          className={`mode-group ${activeMode === 'warping' ? 'active' : ''}`}
        >
          <button
            className={`editor-btn small ${activeMode === 'warping' ? 'active' : ''}`}
            onClick={() => handleToggle('warping')}
          >
            Warp Mode: {activeMode === 'warping' ? 'ON' : 'OFF'}
          </button>
          <div className="mode-inputs">
            <label htmlFor="mapTo">Map To:</label>
            <input type="number" id="mapTo" name="mapTo" />
            <label htmlFor="xTo">Tile X:</label>
            <input type="number" id="xTo" name="xTo" />
            <label htmlFor="yTo">Tile Y:</label>
            <input type="number" id="yTo" name="yTo" />
          </div>
        </div>

        <div className={`mode-group ${activeMode === 'npc' ? 'active' : ''}`}>
          <button
            className={`editor-btn small ${activeMode === 'npc' ? 'active' : ''}`}
            onClick={() => handleToggle('npc')}
          >
            NPC Mode: {activeMode === 'npc' ? 'ON' : 'OFF'}
          </button>
          <div className="mode-inputs">
            <label htmlFor="npc">NPC:</label>
            <AsyncSelect
              loadOptions={loadNpcs}
              value={selectedNpc}
              onChange={setSelectedNpc}
            />
          </div>
        </div>

        <div className={`mode-group ${activeMode === 'item' ? 'active' : ''}`}>
          <button
            className={`editor-btn small ${activeMode === 'item' ? 'active' : ''}`}
            onClick={() => handleToggle('item')}
          >
            Item Mode: {activeMode === 'item' ? 'ON' : 'OFF'}
          </button>
          <div className="mode-inputs">
            <label htmlFor="item">Item:</label>
            <AsyncSelect
              loadOptions={loadItems}
              value={selectedItem}
              onChange={setSelectedItem}
            />
          </div>
        </div>

        <div className={`mode-group ${activeMode === 'shop' ? 'active' : ''}`}>
          <button
            className={`editor-btn small ${activeMode === 'shop' ? 'active' : ''}`}
            onClick={() => handleToggle('shop')}
          >
            Shop Mode: {activeMode === 'shop' ? 'ON' : 'OFF'}
          </button>
          <div className="mode-inputs">
            <label htmlFor="shop">Shop:</label>
            <AsyncSelect
              loadOptions={loadShops}
              value={selectedShop}
              onChange={setSelectedShop}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
