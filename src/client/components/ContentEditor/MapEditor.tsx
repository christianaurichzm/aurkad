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

  const handleSelect = async (mapId: string) => {
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
    const data = {
      name,
      type,
    };

    const result = selectedId
      ? await updateMap(selectedId, data)
      : await createMap(data);
    chatResultMsg(!!result, 'Map saved!', 'Error saving map');
    refreshData();
    reset();
  };

  return (
    <div style={styles.group}>
      <h3 style={styles.h3}>Map Editor</h3>

      <label style={styles.label}>Select Map</label>
      <AsyncSelect
        loadOptions={loadMaps}
        value={selectedId}
        onChange={handleSelect}
      />

      <label style={styles.label}>Map Name</label>
      <input
        style={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Map name"
      />

      <label style={styles.label}>Map Type</label>
      <AsyncSelect
        loadOptions={async () => mapTypeOptions}
        value={type}
        onChange={(v) => setType(v as MapType)}
      />

      <div style={styles.actions}>
        <button style={styles.btn} onClick={handleSave}>
          {selectedId ? 'Save Map' : 'Create Map'}
        </button>
      </div>
    </div>
  );
};

const styles = {
  group: {
    background: '#f9f9f9',
    borderRadius: 12,
    padding: '18px 15px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 12,
    border: '1px solid #e9fbe9',
  },
  h3: {
    margin: 0,
    marginBottom: 5,
    color: '#333',
    fontWeight: 700,
    fontSize: '1rem',
    textAlign: 'left' as const,
  },
  label: {
    fontWeight: 600,
    color: '#218c49',
    fontSize: 14,
    marginBottom: 2,
    display: 'block' as const,
  },
  input: {
    width: '100%',
    padding: '9px 10px',
    border: '1.5px solid #a0e0a0',
    borderRadius: 6,
    outline: 'none',
    fontSize: 14,
    background: '#fff',
    marginBottom: 5,
    transition: 'border 0.16s, background 0.16s',
  },
  actions: {
    display: 'flex' as const,
    gap: 10,
    marginTop: 5,
  },
  btn: {
    background: colors.primary,
    color: '#fff',
    border: 'none',
    padding: '9px 16px',
    borderRadius: radius.md,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    transition: 'background 0.2s',
    flexGrow: 1,
    textAlign: 'center' as const,
  },
};
