import React, { useCallback, useEffect, useState } from 'react';
import {
  saveCurrentMap,
  fillMap,
  toggleBlocking,
  toggleWarping,
  toggleNpc,
  toggleItem,
  toggleShop,
  toggleBank,
  setMapEdited,
  toggleAvoidNpc,
  toggleFringe,
  toggleHeal,
  toggleKill,
  toggleWarn,
  undo,
  redo,
} from '../../graphics/tileset';
import { useUIStore } from '../../stores/uiStore';
import {
  fetchNpcs,
  fetchItems,
  fetchShops,
  fetchMap,
  fetchMaps,
} from '../../io/network';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { Select } from '../common/Select/Select';
import { MapType, RuntimeNpc, TileEditMode } from '../../../shared/types';
import { getGameState } from '../../core/gameState';
import { SpritePreview } from '../common/SpritePreview';
import { colors, radius } from '../../theme';

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: colors.textMuted,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 2,
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

const modes: TileEditMode[] = [
  'blocking',
  'warping',
  'npc',
  'item',
  'shop',
  'bank',
  'avoidNpc',
  'fringe',
  'heal',
  'kill',
  'warn',
];
const modeLabels: Record<TileEditMode, string> = {
  blocking: 'Block',
  warping: 'Warp',
  npc: 'NPC',
  item: 'Item',
  shop: 'Shop',
  bank: 'Bank',
  avoidNpc: 'Avoid',
  fringe: 'Fringe',
  heal: 'Heal',
  kill: 'Kill',
  warn: 'Warn',
};

const TilesetModeControlsComponent: React.FC = () => {
  const mapEdited = useUIStore((state) => state.mapEdited);

  const [activeMode, setActiveMode] = useState<TileEditMode | null>(null);
  const [selectedNpc, setSelectedNpc] = useState<string | number>('');
  const [selectedItem, setSelectedItem] = useState<string | number>('');
  const [selectedShop, setSelectedShop] = useState<string | number>('');
  const [selectedWarpMap, setSelectedWarpMap] = useState<string>('');
  const [npcList, setNpcList] = useState<RuntimeNpc[]>([]);
  const [mapType, setMapType] = useState<MapType>('normal');
  const [mapName, setMapName] = useState<string>('');

  const loadMapData = useCallback(async () => {
    const state = getGameState();
    if (state?.id) {
      const map = await fetchMap(state.id);
      if (map) {
        setMapType(map.type);
        setMapName(map.name);
      } else {
        setMapType('normal');
        setMapName('New Map');
      }
    }
  }, []);

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
  useEffect(() => {
    (window as any).selectedWarpMap = selectedWarpMap;
  }, [selectedWarpMap]);

  const loadNpcs = useCallback(async () => {
    const npcs = await fetchNpcs();
    setNpcList(npcs);
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

  const loadMaps = useCallback(async () => {
    const maps = await fetchMaps();
    return maps.map((m) => ({ value: m.id, label: `${m.id} - ${m.name}` }));
  }, []);

  const handleSave = async () => {
    if (!mapEdited) return;
    try {
      const result = await saveCurrentMap(mapName, mapType);
      if (!result?.success) {
        const body = result as unknown as { errors?: string[] };
        await useUIStore.getState().showDialog({
          title: 'Save blocked',
          message: body?.errors?.join('\n') ?? 'Validation failed.',
          kind: 'error',
        });
        return;
      }
      if (result.warnings.length > 0) {
        await useUIStore.getState().showDialog({
          title: 'Map saved with warnings',
          message: result.warnings.join('\n'),
          kind: 'info',
        });
      }
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
      bank: toggleBank,
      avoidNpc: toggleAvoidNpc,
      fringe: toggleFringe,
      heal: toggleHeal,
      kill: toggleKill,
      warn: toggleWarn,
    };
    toggleMap[mode]?.();
  };

  return (
    <div
      style={{
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        minWidth: 260,
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}
        >
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={labelStyle}>Type</label>
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
          onClick={() => fillMap()}
          style={ghostBtn}
          title="Fill entire map with selected tile"
        >
          Fill
        </button>
        <button onClick={() => undo()} style={ghostBtn} title="Undo (Ctrl+Z)">
          ↩
        </button>
        <button
          onClick={() => redo()}
          style={ghostBtn}
          title="Redo (Ctrl+Y / Ctrl+Shift+Z)"
        >
          ↪
        </button>
        <button
          id="saveButton"
          onClick={handleSave}
          disabled={!mapEdited}
          style={{
            background: colors.success,
            color: '#fff',
            border: 'none',
            padding: '7px 14px',
            borderRadius: radius.md,
            cursor: !mapEdited ? 'not-allowed' : 'pointer',
            fontWeight: 700,
            fontSize: 13,
            opacity: !mapEdited ? 0.45 : 1,
            flexShrink: 0,
          }}
        >
          Save
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 5,
        }}
      >
        {modes.map((mode) => {
          const isActive = activeMode === mode;
          return (
            <button
              key={mode}
              onClick={() => handleToggle(mode)}
              style={{
                padding: '6px 0',
                border: `1px solid ${isActive ? colors.danger : colors.border}`,
                borderRadius: radius.sm,
                background: isActive ? colors.danger : colors.surfaceMuted,
                color: isActive ? '#fff' : colors.text,
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
            >
              {modeLabels[mode]}
            </button>
          );
        })}
      </div>

      {activeMode === 'warping' && (
        <div style={inputsBox}>
          <label style={labelStyle}>Map</label>
          <AsyncSelect
            loadOptions={loadMaps}
            value={selectedWarpMap}
            onChange={setSelectedWarpMap}
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

      {activeMode === 'npc' && (
        <div style={inputsBox}>
          <label style={labelStyle}>NPC</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ flex: 1 }}>
              <AsyncSelect
                loadOptions={loadNpcs}
                value={selectedNpc}
                onChange={setSelectedNpc}
              />
            </div>
            {!!selectedNpc &&
              (() => {
                const npc = npcList.find(
                  (n) => String(n.id) === String(selectedNpc),
                );
                return npc ? (
                  <SpritePreview spriteId={npc.sprite} size={36} />
                ) : null;
              })()}
          </div>
        </div>
      )}

      {activeMode === 'item' && (
        <div style={inputsBox}>
          <label style={labelStyle}>Item</label>
          <AsyncSelect
            loadOptions={loadItems}
            value={selectedItem}
            onChange={setSelectedItem}
          />
        </div>
      )}

      {activeMode === 'shop' && (
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
};

const ghostBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '7px 10px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
  flexShrink: 0,
};

export const TilesetModeControls = React.memo(TilesetModeControlsComponent);
