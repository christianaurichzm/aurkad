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
import { colors, radius } from '../../theme';

const btn: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '7px 12px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.85rem',
};

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
  marginBottom: 2,
};

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
    avoidNpc: 'Avoid NPC',
  };

  return (
    <div
      style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle} htmlFor="mapName">
            Map name
          </label>
          <input
            id="mapName"
            type="text"
            placeholder="Map name"
            value={mapName}
            style={inputStyle}
            onChange={(e) => {
              const name = e.target.value;
              setMapName(name);
              if (name !== mapName) setMapEdited(true);
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={labelStyle}>Map type</label>
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

        <button
          id="saveButton"
          onClick={handleSave}
          disabled={!mapEdited}
          style={{
            ...btn,
            background: colors.success,
            opacity: !mapEdited ? 0.45 : 1,
            cursor: !mapEdited ? 'not-allowed' : 'pointer',
          }}
        >
          Save Map
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {modes.map((mode) => {
          const isActive = activeMode === mode;
          return (
            <div
              key={mode}
              style={{ display: 'flex', flexDirection: 'column', gap: 5 }}
            >
              <button
                style={{
                  ...btn,
                  background: isActive ? colors.danger : colors.primary,
                }}
                onClick={() => handleToggle(mode)}
              >
                {modeLabels[mode]}: {isActive ? 'ON' : 'OFF'}
              </button>

              {isActive && mode === 'warping' && (
                <div style={inputsBox}>
                  <label style={labelStyle} htmlFor="mapTo">
                    Map To
                  </label>
                  <input
                    type="number"
                    id="mapTo"
                    name="mapTo"
                    style={inputStyle}
                  />
                  <label style={labelStyle} htmlFor="xTo">
                    Tile X
                  </label>
                  <input type="number" id="xTo" name="xTo" style={inputStyle} />
                  <label style={labelStyle} htmlFor="yTo">
                    Tile Y
                  </label>
                  <input type="number" id="yTo" name="yTo" style={inputStyle} />
                </div>
              )}

              {isActive && mode === 'npc' && (
                <div style={inputsBox}>
                  <label style={labelStyle}>NPC</label>
                  <AsyncSelect
                    loadOptions={loadNpcs}
                    value={selectedNpc}
                    onChange={setSelectedNpc}
                  />
                </div>
              )}

              {isActive && mode === 'item' && (
                <div style={inputsBox}>
                  <label style={labelStyle}>Item</label>
                  <AsyncSelect
                    loadOptions={loadItems}
                    value={selectedItem}
                    onChange={setSelectedItem}
                  />
                </div>
              )}

              {isActive && mode === 'shop' && (
                <div style={inputsBox}>
                  <label style={labelStyle}>Shop</label>
                  <AsyncSelect
                    loadOptions={loadShops}
                    value={selectedShop}
                    onChange={setSelectedShop}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const inputsBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
};

export const TilesetModeControls = React.memo(TilesetModeControlsComponent);
