import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { MapStateClient, MapType } from '../../../shared/types';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { chatResultMsg } from '../ChatPanel';
import { updateMap, createMap, resizeMap } from '../../io/network';
import { colors, radius } from '../../theme';

interface MapEditorProps {
  maps: MapStateClient[];
  loadMaps: () => Promise<any>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

type MapFormValues = {
  name: string;
  type: MapType;
  cols: number;
  rows: number;
};

const defaultValues: MapFormValues = {
  name: '',
  type: 'normal',
  cols: 20,
  rows: 14,
};

const mapToFormValues = (map: MapStateClient): MapFormValues => ({
  name: map.name ?? '',
  type: map.type ?? 'normal',
  cols: map.tiles?.[0]?.length ?? 20,
  rows: map.tiles?.length ?? 14,
});

export const MapEditor: React.FC<MapEditorProps> = ({
  maps,
  refreshData,
  loadMaps,
  onDirtyChange,
  requestDiscard,
}) => {
  const [selectedId, setSelectedId] = useState<string>('');
  const [resizeCols, setResizeCols] = useState(20);
  const [resizeRows, setResizeRows] = useState(14);
  const [showResize, setShowResize] = useState(false);
  const {
    control,
    formState: { isDirty },
    handleSubmit,
    register,
    reset: resetForm,
    watch,
  } = useForm<MapFormValues>({ defaultValues });

  const name = watch('name');

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const mapTypeOptions: { value: MapType; label: string }[] = [
    { value: 'normal', label: 'Normal' },
    { value: 'pvp', label: 'PvP' },
  ];

  const handleSelect = async (mapId: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(mapId);
    setShowResize(false);
    const map = maps.find((m) => m.id === mapId);
    if (map) {
      resetForm(mapToFormValues(map));
      setResizeCols(map.tiles?.[0]?.length ?? 20);
      setResizeRows(map.tiles?.length ?? 14);
    }
  };

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

  const handleSave = async ({ name, type, cols, rows }: MapFormValues) => {
    const result = selectedId
      ? await updateMap(selectedId, { name, type })
      : await createMap({ name, type, cols, rows });
    chatResultMsg(!!result, 'Map saved!', 'Error saving map');
    refreshData();
    setSelectedId('');
    setShowResize(false);
    resetForm(defaultValues);
  };

  const handleResize = async () => {
    if (!selectedId) return;
    const result = await resizeMap(selectedId, resizeCols, resizeRows);
    chatResultMsg(!!result?.success, 'Map resized!', 'Error resizing map');
    if (result?.success) {
      setShowResize(false);
      refreshData();
    }
  };

  return (
    <form style={container} onSubmit={handleSubmit(handleSave)}>
      <div style={field}>
        <label style={label}>Map</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadMaps}
              value={selectedId}
              onChange={(id) => void handleSelect(id)}
            />
          </div>
          {selectedId && (
            <button type="button" style={resetBtn} onClick={() => void reset()}>
              New
            </button>
          )}
        </div>
      </div>

      <div style={field}>
        <label style={label}>Map Name</label>
        <input style={input} {...register('name')} placeholder="Map name" />
      </div>

      <div style={field}>
        <label style={label}>Map Type</label>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <AsyncSelect<MapType>
              loadOptions={async () => mapTypeOptions}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      {!selectedId && (
        <div style={field}>
          <label style={label}>Size (cols × rows)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...input, width: 80 }}
              type="number"
              min={1}
              max={200}
              {...register('cols', { valueAsNumber: true })}
              placeholder="Cols"
            />
            <input
              style={{ ...input, width: 80 }}
              type="number"
              min={1}
              max={200}
              {...register('rows', { valueAsNumber: true })}
              placeholder="Rows"
            />
          </div>
        </div>
      )}

      {selectedId && (
        <div style={field}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <label style={label}>Resize map</label>
            <button
              type="button"
              style={resetBtn}
              onClick={() => setShowResize((v) => !v)}
            >
              {showResize ? 'Cancel' : 'Resize'}
            </button>
          </div>
          {showResize && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <input
                style={{ ...input, width: 80 }}
                type="number"
                min={1}
                max={200}
                value={resizeCols}
                onChange={(e) => setResizeCols(Number(e.target.value))}
                placeholder="Cols"
              />
              <input
                style={{ ...input, width: 80 }}
                type="number"
                min={1}
                max={200}
                value={resizeRows}
                onChange={(e) => setResizeRows(Number(e.target.value))}
                placeholder="Rows"
              />
              <button
                type="button"
                style={saveBtn}
                onClick={() => void handleResize()}
              >
                Apply
              </button>
            </div>
          )}
        </div>
      )}

      <button type="submit" style={saveBtn} disabled={!name.trim()}>
        {selectedId ? 'Save Map' : 'Create Map'}
      </button>
    </form>
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
