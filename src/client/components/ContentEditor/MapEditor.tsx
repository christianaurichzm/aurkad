import React, { useState } from 'react';
import { MapStateClient, MapType } from '../../../shared/types';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { chatResultMsg } from '../ChatPanel';
import { updateMap, createMap } from '../../io/network';
import { colors, radius } from '../../theme';

interface MapEditorProps {
  maps: MapStateClient[];
  loadMaps: () => Promise<any>;
  refreshData: () => void;
}

export const MapEditor: React.FC<MapEditorProps> = ({
  maps,
  refreshData,
  loadMaps,
}) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [name, setName] = useState('');
  const [type, setType] = useState<MapType>('normal');

  const mapTypeOptions = [
    { value: 'normal', label: 'Normal' },
    { value: 'pvp', label: 'PvP' },
  ];

  const handleSelect = (mapId: string) => {
    setSelectedId(mapId);
    const map = maps.find((m) => m.id === mapId);
    if (map) {
      setName(map.name ?? '');
      setType(map.type ?? 'normal');
    }
  };

  const reset = () => {
    setSelectedId('');
    setName('');
    setType('normal');
  };

  const handleSave = async () => {
    const result = selectedId
      ? await updateMap(selectedId, { name, type })
      : await createMap({ name, type });
    chatResultMsg(!!result, 'Map saved!', 'Error saving map');
    refreshData();
    reset();
  };

  return (
    <div style={container}>
      <div style={field}>
        <label style={label}>Map</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadMaps}
              value={selectedId}
              onChange={handleSelect}
            />
          </div>
          {selectedId && (
            <button style={resetBtn} onClick={reset}>
              New
            </button>
          )}
        </div>
      </div>

      <div style={field}>
        <label style={label}>Map Name</label>
        <input
          style={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Map name"
        />
      </div>

      <div style={field}>
        <label style={label}>Map Type</label>
        <AsyncSelect
          loadOptions={async () => mapTypeOptions}
          value={type}
          onChange={(v) => setType(v as MapType)}
        />
      </div>

      <button style={saveBtn} onClick={handleSave} disabled={!name.trim()}>
        {selectedId ? 'Save Map' : 'Create Map'}
      </button>
    </div>
  );
};

const container: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
};

const input: React.CSSProperties = {
  padding: '7px 9px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  background: colors.surface,
};

const saveBtn: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '10px 16px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
  width: '100%',
};

const resetBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '7px 12px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
};
