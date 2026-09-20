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
  toggleMask,
  toggleHeal,
  toggleKill,
  toggleWarn,
  toggleDoor,
  toggleSound,
  toggleChangeSprite,
  toggleScript,
  setPendingScriptTrigger,
  toggleConditionalBlock,
  setEditorMusic,
  setEditorMapId,
  setEditorTiles,
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
import { ScriptBehaviorFields } from '../ContentEditor/ScriptBehaviorFields';
import type { ScriptParams } from '../../../shared/scriptParams';
import { MapType, RuntimeNpc, TileEditMode } from '../../../shared/types';
import { getGameState } from '../../core/gameState';
import { SpritePreview } from '../common/SpritePreview';
import { colors, radius } from '../../theme';
import { t, useT, type TranslationKey } from '../../i18n';

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

const propModes: TileEditMode[] = [
  'blocking',
  'warping',
  'npc',
  'item',
  'shop',
  'bank',
  'avoidNpc',
  'heal',
  'kill',
  'warn',
  'door',
  'sound',
  'changeSprite',
  'script',
  'conditionalBlock',
];
const layerModes: TileEditMode[] = ['mask', 'fringe'];
const modeLabels: Record<TileEditMode, TranslationKey> = {
  blocking: 'tileMode.blocking',
  warping: 'tileMode.warping',
  npc: 'tileMode.npc',
  item: 'tileMode.item',
  shop: 'tileMode.shop',
  bank: 'tileMode.bank',
  avoidNpc: 'tileMode.avoidNpc',
  fringe: 'tileMode.fringe',
  mask: 'tileMode.mask',
  heal: 'tileMode.heal',
  kill: 'tileMode.kill',
  warn: 'tileMode.warn',
  door: 'tileMode.door',
  sound: 'tileMode.sound',
  changeSprite: 'tileMode.changeSprite',
  script: 'tileMode.script',
  conditionalBlock: 'tileMode.conditionalBlock',
};
const layerActiveColor: Partial<Record<TileEditMode, string>> = {
  mask: '#00bcd4',
  fringe: '#9c27b0',
};

// The painter reads these back by id (domHelpers.getInputValue): they are the
// selection for the tile kinds that have no DOM input of their own.
const editorSelection = window as unknown as Record<string, string | number>;

const TilesetModeControlsComponent: React.FC = () => {
  const translate = useT();
  const mapEdited = useUIStore((state) => state.mapEdited);
  const currentMapId = useUIStore((state) => state.currentMap?.id);

  const [activeMode, setActiveMode] = useState<TileEditMode | null>(null);
  const [selectedNpc, setSelectedNpc] = useState<string | number>('');
  const [selectedItem, setSelectedItem] = useState<string | number>('');
  const [selectedShop, setSelectedShop] = useState<string | number>('');
  const [selectedWarpMap, setSelectedWarpMap] = useState<string>('');
  const [scriptId, setScriptId] = useState<string>('');
  const [scriptParams, setScriptParams] = useState<ScriptParams>({});
  const [npcList, setNpcList] = useState<RuntimeNpc[]>([]);
  const [mapType, setMapType] = useState<MapType>('normal');
  const [mapName, setMapName] = useState<string>('');
  const [mapMusic, setMapMusic] = useState<string>('');

  const loadMapData = useCallback(async () => {
    const mapId = getGameState()?.id;
    if (!mapId) return;
    // Edits belong to the map they were painted on, and the ground draws from
    // the editor's copy while this is set, so it is cleared before the fetch.
    setMapEdited(false);
    const map = await fetchMap(mapId);
    // The player walked on while this was in flight, so the load for the new
    // map is right behind; this answer is dropped.
    if (getGameState()?.id !== mapId) return;
    setEditorMapId(mapId);
    if (map) {
      setMapType(map.type);
      setMapName(map.name);
      const music = map.music ?? '';
      setMapMusic(music);
      setEditorMusic(music);
      setEditorTiles(map.tiles, music);
    } else {
      setMapType('normal');
      setMapName(t('tileset.newMap'));
      setMapMusic('');
      setEditorMusic('');
    }
  }, []);

  // Re-fetched when the player walks into another map, so the editor
  // follows the game.
  useEffect(() => {
    void loadMapData();
  }, [loadMapData, currentMapId]);

  useEffect(() => {
    editorSelection.selectedNpc = selectedNpc;
  }, [selectedNpc]);
  useEffect(() => {
    editorSelection.selectedItem = selectedItem;
  }, [selectedItem]);
  useEffect(() => {
    editorSelection.selectedShop = selectedShop;
  }, [selectedShop]);
  useEffect(() => {
    editorSelection.selectedWarpMap = selectedWarpMap;
  }, [selectedWarpMap]);
  // Typed values cannot survive a round trip through a DOM input, so the
  // painter is told about them instead of reading them back out.
  useEffect(() => {
    setPendingScriptTrigger(scriptId, scriptParams);
  }, [scriptId, scriptParams]);

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
          title: t('tileset.saveBlocked'),
          message: body?.errors?.join('\n') ?? t('tileset.validationFailed'),
          kind: 'error',
        });
        return;
      }
      if (result.warnings.length > 0) {
        await useUIStore.getState().showDialog({
          title: t('tileset.savedWithWarnings'),
          message: result.warnings.join('\n'),
          kind: 'info',
        });
      }
      await loadMapData();
    } catch {
      await useUIStore.getState().showDialog({
        title: t('tileset.saveFailed'),
        message: t('tileset.saveFailedMessage'),
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
      mask: toggleMask,
      heal: toggleHeal,
      kill: toggleKill,
      warn: toggleWarn,
      door: toggleDoor,
      sound: toggleSound,
      changeSprite: toggleChangeSprite,
      script: toggleScript,
      conditionalBlock: toggleConditionalBlock,
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
      {/* Wraps because seven controls in one row on a phone left the two text
          fields three characters wide. */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'flex-end',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            flex: '1 1 120px',
          }}
        >
          <label style={labelStyle} htmlFor="mapName">
            {translate('tileset.mapName')}
          </label>
          <input
            id="mapName"
            type="text"
            placeholder={translate('tileset.mapName')}
            value={mapName}
            style={inputStyle}
            onChange={(e) => {
              const name = e.target.value;
              setMapName(name);
              if (name !== mapName) setMapEdited(true);
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 3,
            flex: '1 1 120px',
          }}
        >
          <label style={labelStyle} htmlFor="mapMusic">
            {translate('tileset.music')}
          </label>
          <input
            id="mapMusic"
            type="text"
            placeholder="music.mp3"
            value={mapMusic}
            style={inputStyle}
            onChange={(e) => {
              const music = e.target.value;
              setMapMusic(music);
              setEditorMusic(music);
              setMapEdited(true);
            }}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <label style={labelStyle}>{translate('editor.type')}</label>
          <Select
            options={[
              { value: 'pvp', label: translate('map.typePvp') },
              { value: 'normal', label: translate('map.typeNormal') },
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
          title={translate('tileset.fillHelp')}
        >
          {translate('tileset.fill')}
        </button>
        <button
          onClick={() => undo()}
          style={ghostBtn}
          title={translate('tileset.undo')}
        >
          ↩
        </button>
        <button
          onClick={() => redo()}
          style={ghostBtn}
          title={translate('tileset.redo')}
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
          {translate('common.save')}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 5,
        }}
      >
        {propModes.map((mode) => {
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
              {translate(modeLabels[mode])}
            </button>
          );
        })}
      </div>

      <div
        style={{
          borderTop: `1px solid ${colors.border}`,
          paddingTop: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        <span style={{ ...labelStyle, marginBottom: 0 }}>
          {translate('tileset.layers')}
        </span>
        <div style={{ display: 'flex', gap: 5 }}>
          {layerModes.map((mode) => {
            const isActive = activeMode === mode;
            const activeColor = layerActiveColor[mode] ?? colors.danger;
            return (
              <button
                key={mode}
                onClick={() => handleToggle(mode)}
                style={{
                  flex: 1,
                  padding: '6px 0',
                  border: `1px solid ${isActive ? activeColor : colors.border}`,
                  borderRadius: radius.sm,
                  background: isActive ? activeColor : colors.surfaceMuted,
                  color: isActive ? '#fff' : colors.text,
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                  transition: 'all 0.12s',
                }}
              >
                {translate(modeLabels[mode])}
              </button>
            );
          })}
        </div>
      </div>

      {activeMode === 'warping' && (
        <div style={inputsBox}>
          <label style={labelStyle}>{translate('map.map')}</label>
          <AsyncSelect
            loadOptions={loadMaps}
            value={selectedWarpMap}
            onChange={setSelectedWarpMap}
          />
          <label style={labelStyle} htmlFor="xTo">
            {translate('tileset.tileX')}
          </label>
          <input type="number" id="xTo" name="xTo" style={inputStyle} />
          <label style={labelStyle} htmlFor="yTo">
            {translate('tileset.tileY')}
          </label>
          <input type="number" id="yTo" name="yTo" style={inputStyle} />
        </div>
      )}

      {activeMode === 'npc' && (
        <div style={inputsBox}>
          <label style={labelStyle}>{translate('npc.npc')}</label>
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
          <label style={labelStyle}>{translate('item.item')}</label>
          <AsyncSelect
            loadOptions={loadItems}
            value={selectedItem}
            onChange={setSelectedItem}
          />
        </div>
      )}

      {activeMode === 'shop' && (
        <div style={inputsBox}>
          <label style={labelStyle}>{translate('shopEditor.shop')}</label>
          <AsyncSelect
            loadOptions={loadShops}
            value={selectedShop}
            onChange={setSelectedShop}
          />
        </div>
      )}

      {activeMode === 'door' && (
        <div style={inputsBox}>
          <label style={labelStyle} htmlFor="doorItem">
            {translate('tileset.doorItem')}
          </label>
          <input
            type="number"
            id="doorItem"
            style={inputStyle}
            defaultValue={0}
          />
          <label style={labelStyle} htmlFor="doorOpenTile">
            {translate('tileset.doorOpenTile')}
          </label>
          <input
            type="number"
            id="doorOpenTile"
            style={inputStyle}
            defaultValue={0}
          />
        </div>
      )}

      {activeMode === 'sound' && (
        <div style={inputsBox}>
          <label style={labelStyle} htmlFor="soundFile">
            {translate('tileset.soundFile')}
          </label>
          <input
            type="text"
            id="soundFile"
            placeholder="magiceffect.mp3"
            style={inputStyle}
          />
        </div>
      )}

      {activeMode === 'changeSprite' && (
        <div style={inputsBox}>
          <label style={labelStyle} htmlFor="changeSpriteId">
            {translate('editor.spriteId')}
          </label>
          <input
            type="number"
            id="changeSpriteId"
            style={inputStyle}
            defaultValue={0}
          />
        </div>
      )}

      {activeMode === 'script' && (
        <ScriptBehaviorFields
          events={['onEnter']}
          scriptId={scriptId}
          onScriptIdChange={setScriptId}
          params={scriptParams}
          onParamsChange={setScriptParams}
          hint={translate('tileset.scriptHint')}
          loadItems={loadItems}
          loadNpcs={loadNpcs}
        />
      )}

      {activeMode === 'conditionalBlock' && (
        <div style={inputsBox}>
          <label style={labelStyle} htmlFor="conditionalBlockId">
            {translate('tileset.blockId')}
          </label>
          <input
            type="text"
            id="conditionalBlockId"
            placeholder="myBlockScript"
            style={inputStyle}
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
