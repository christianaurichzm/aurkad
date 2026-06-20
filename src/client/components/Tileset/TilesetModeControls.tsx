import React, { useCallback, useEffect, useState } from 'react';
import {
  saveCurrentMap,
  toggleBlocking,
  toggleWarping,
  toggleNpc,
  toggleItem,
  toggleShop,
  setMapEdited,
  toggleAvoidNpc,
} from '../../graphics/tileset';
import { useUIStore } from '../../stores/uiStore';
import { fetchNpcs, fetchItems, fetchShops, fetchMap } from '../../io/network';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { Select } from '../common/Select/Select';
import { MapType, TileEditMode } from '../../../shared/types';
import { getGameState } from '../../core/gameState';
import { useGame } from '../../context/GameContext';

const TilesetModeControlsComponent: React.FC = () => {
  const { setMap } = useGame();
  const mapEdited = useUIStore((state) => state.mapEdited);

  const [activeMode, setActiveMode] = useState<TileEditMode | null>(null);

  const [selectedNpc, setSelectedNpc] = useState<string | number>('');
  const [selectedItem, setSelectedItem] = useState<string | number>('');
  const [selectedShop, setSelectedShop] = useState<string | number>('');

  const [mapType, setMapType] = useState<MapType>('normal');
  const [mapName, setMapName] = useState<string>('');

  const loadMapData = useCallback(async () => {
    const state = getGameState();
    if (state?.id) {
      const map = await fetchMap(state.id);
      if (map) {
        setMapType(map.type);
        setMapName(map.name);
        setMap(map);
      } else {
        setMapType('normal');
        setMapName('New Map');
      }
    }
  }, [setMap]);

  useEffect(() => {
    loadMapData();
  }, [loadMapData]);

  useEffect(() => {
    (window as any).selectedNpc = selectedNpc;
  }, [selectedNpc]);

  useEffect(() => {
    (window as any).selectedItem = selectedItem;
  }, [selectedItem]);

  useEffect(() => {
    (window as any).selectedShop = selectedShop;
  }, [selectedShop]);

  const loadNpcs = useCallback(async () => {
    const npcs = await fetchNpcs();
    return npcs.map((n) => ({ value: n.id, label: `${n.id} - ${n.name}` }));
  }, []);

  const loadItems = useCallback(async () => {
    const items = await fetchItems();
    return items.map((i) => ({ value: i.id, label: `${i.id} - ${i.name}` }));
  }, []);

  const loadShops = useCallback(async () => {
    const shops = await fetchShops();
    return shops.map((s) => ({ value: s.id, label: `${s.id} - ${s.name}` }));
  }, []);

  const handleSave = async () => {
    if (!mapEdited) return;
    try {
      await saveCurrentMap(mapName, mapType);
      await loadMapData();
    } catch {
      await useUIStore.getState().showDialog({
        title: 'Save failed',
        message: 'Failed to save map. Please try again.',
        kind: 'error',
      });
    }
  };

  const handleToggle = (mode: TileEditMode) => {
    const newMode = activeMode === mode ? null : mode;
    setActiveMode(newMode);

    const toggleMap: Record<TileEditMode, () => void> = {
      blocking: toggleBlocking,
      warping: toggleWarping,
      npc: toggleNpc,
      item: toggleItem,
      shop: toggleShop,
      avoidNpc: toggleAvoidNpc,
    };

    toggleMap[mode]?.();
  };

  const modes: TileEditMode[] = [
    'blocking',
    'warping',
    'npc',
    'item',
    'shop',
    'avoidNpc',
  ];
  const modeLabels: Record<TileEditMode, string> = {
    blocking: 'Blocking',
    warping: 'Warp',
    npc: 'NPC',
    item: 'Item',
    shop: 'Shop',
    avoidNpc: 'Avoid Npc',
  };

  return (
    <div className="tileset-controls">
      <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
        <button
          id="saveButton"
          className="editor-btn save-btn"
          onClick={handleSave}
          disabled={!mapEdited}
          style={{ marginTop: '20px' }}
        >
          Save Map
        </button>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label htmlFor="mapName" style={{ marginBottom: 2 }}>
            Map name
          </label>
          <input
            id="mapName"
            type="text"
            placeholder="Map name"
            value={mapName}
            onChange={(e) => {
              const name = e.target.value;
              setMapName(name);
              if (name !== mapName) setMapEdited(true);
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <label style={{ marginBottom: 2 }}>Map type</label>
          <Select
            options={[
              { value: 'pvp', label: 'PvP' },
              { value: 'normal', label: 'Normal' },
            ]}
            value={mapType}
            onChange={(value) => {
              if (value === 'pvp' || value === 'normal') {
                setMapType(value);
                if (value !== mapType) setMapEdited(true);
              }
            }}
          />
        </div>
      </div>

      <div className="mode-controls" style={{ marginTop: '15px' }}>
        {modes.map((mode) => (
          <div
            key={mode}
            className={`mode-group ${activeMode === mode ? 'active' : ''}`}
          >
            <button
              className={`editor-btn small ${activeMode === mode ? 'active' : ''}`}
              onClick={() => handleToggle(mode)}
            >
              {modeLabels[mode]} Mode: {activeMode === mode ? 'ON' : 'OFF'}
            </button>

            {mode === 'warping' && (
              <div className="mode-inputs">
                <label htmlFor="mapTo">Map To:</label>
                <input type="number" id="mapTo" name="mapTo" />
                <label htmlFor="xTo">Tile X:</label>
                <input type="number" id="xTo" name="xTo" />
                <label htmlFor="yTo">Tile Y:</label>
                <input type="number" id="yTo" name="yTo" />
              </div>
            )}

            {mode === 'npc' && (
              <div className="mode-inputs">
                <label htmlFor="npc">NPC:</label>
                <AsyncSelect
                  loadOptions={loadNpcs}
                  value={selectedNpc}
                  onChange={setSelectedNpc}
                />
              </div>
            )}

            {mode === 'item' && (
              <div className="mode-inputs">
                <label htmlFor="item">Item:</label>
                <AsyncSelect
                  loadOptions={loadItems}
                  value={selectedItem}
                  onChange={setSelectedItem}
                />
              </div>
            )}

            {mode === 'shop' && (
              <div className="mode-inputs">
                <label htmlFor="shop">Shop:</label>
                <AsyncSelect
                  loadOptions={loadShops}
                  value={selectedShop}
                  onChange={setSelectedShop}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export const TilesetModeControls = React.memo(TilesetModeControlsComponent);
