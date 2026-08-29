import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { MapStateClient, MapType, type Warp } from '../../../shared/types';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { chatResultMsg } from '../ChatPanel';
import { updateMap, createMap, resizeMap } from '../../io/network';
import { colors, radius } from '../../theme';
import { TILE_SIZE } from '../../../shared/constants';
import { useT, type TranslationKey } from '../../i18n';

interface MapEditorProps {
  maps: MapStateClient[];
  loadMaps: () => Promise<any>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

type BorderLinkForm = { mapId: string; tileX: number; tileY: number };
type MapFormValues = {
  name: string;
  type: MapType;
  cols: number;
  rows: number;
  music: string;
  instanced: boolean;
  borderUp: BorderLinkForm;
  borderDown: BorderLinkForm;
  borderLeft: BorderLinkForm;
  borderRight: BorderLinkForm;
};

const emptyBorder: BorderLinkForm = { mapId: '', tileX: 0, tileY: 0 };

const BORDER_LABEL: Record<string, TranslationKey> = {
  borderUp: 'map.borderUp',
  borderDown: 'map.borderDown',
  borderLeft: 'map.borderLeft',
  borderRight: 'map.borderRight',
};

const defaultValues: MapFormValues = {
  name: '',
  type: 'normal',
  cols: 20,
  rows: 14,
  music: '',
  instanced: false,
  borderUp: emptyBorder,
  borderDown: emptyBorder,
  borderLeft: emptyBorder,
  borderRight: emptyBorder,
};

function warpToForm(w?: Warp): BorderLinkForm {
  if (!w) return emptyBorder;
  return {
    mapId: w.to,
    tileX: Math.round(w.position.x / TILE_SIZE),
    tileY: Math.round(w.position.y / TILE_SIZE),
  };
}

const mapToFormValues = (map: MapStateClient): MapFormValues => ({
  name: map.name ?? '',
  type: map.type ?? 'normal',
  cols: map.tiles?.[0]?.length ?? 20,
  rows: map.tiles?.length ?? 14,
  music: map.music ?? '',
  instanced: map.instanced ?? false,
  borderUp: warpToForm(map.borderLinks?.up),
  borderDown: warpToForm(map.borderLinks?.down),
  borderLeft: warpToForm(map.borderLinks?.left),
  borderRight: warpToForm(map.borderLinks?.right),
});

export const MapEditor: React.FC<MapEditorProps> = ({
  maps,
  refreshData,
  loadMaps,
  onDirtyChange,
  requestDiscard,
}) => {
  const t = useT();
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
    { value: 'normal', label: t('map.typeNormal') },
    { value: 'pvp', label: t('map.typePvp') },
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

  const buildWarp = (b: BorderLinkForm): Warp | undefined =>
    b.mapId
      ? {
          to: b.mapId,
          position: { x: b.tileX * TILE_SIZE, y: b.tileY * TILE_SIZE },
        }
      : undefined;

  const handleSave = async ({
    name,
    type,
    cols,
    rows,
    music,
    instanced,
    borderUp,
    borderDown,
    borderLeft,
    borderRight,
  }: MapFormValues) => {
    const borderLinks = {
      up: buildWarp(borderUp),
      down: buildWarp(borderDown),
      left: buildWarp(borderLeft),
      right: buildWarp(borderRight),
    };
    const result = selectedId
      ? await updateMap(selectedId, {
          name,
          type,
          music: music || undefined,
          instanced,
          borderLinks,
        })
      : await createMap({ name, type, cols, rows });
    chatResultMsg(!!result, t('map.saved'), t('map.saveError'));
    refreshData();
    setSelectedId('');
    setShowResize(false);
    resetForm(defaultValues);
  };

  const handleResize = async () => {
    if (!selectedId) return;
    const result = await resizeMap(selectedId, resizeCols, resizeRows);
    chatResultMsg(!!result?.success, t('map.resized'), t('map.resizeError'));
    if (result?.success) {
      setShowResize(false);
      refreshData();
    }
  };

  return (
    <form style={container} onSubmit={handleSubmit(handleSave)}>
      <div style={field}>
        <label style={label}>{t('map.map')}</label>
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
              {t('editor.new')}
            </button>
          )}
        </div>
      </div>

      <div style={field}>
        <label style={label}>{t('map.name')}</label>
        <input
          style={input}
          {...register('name')}
          placeholder={t('map.namePlaceholder')}
        />
      </div>

      <div style={field}>
        <label style={label}>{t('map.type')}</label>
        <Controller
          control={control}
          name="type"
          render={({ field }) => (
            <AsyncSelect<MapType>
              loadOptions={() => Promise.resolve(mapTypeOptions)}
              value={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </div>

      {selectedId && (
        <>
          <div style={field}>
            <label style={label}>{t('map.music')}</label>
            <input
              style={input}
              {...register('music')}
              placeholder="music.mp3"
            />
          </div>
          <label style={checkboxField}>
            <input type="checkbox" {...register('instanced')} />
            {t('map.instanced')}
          </label>
          <span style={hint}>{t('map.instancedHint')}</span>
          <div style={field}>
            <label style={label}>{t('map.borderLinks')}</label>
            {(
              ['borderUp', 'borderDown', 'borderLeft', 'borderRight'] as const
            ).map((dir) => (
              <div
                key={dir}
                style={{
                  display: 'flex',
                  gap: 6,
                  alignItems: 'center',
                  marginBottom: 4,
                }}
              >
                <span style={{ ...label, width: 36, marginBottom: 0 }}>
                  {t(BORDER_LABEL[dir] ?? 'map.borderUp')}
                </span>
                <input
                  style={{ ...input, flex: 2 }}
                  placeholder={t('map.mapIdPlaceholder')}
                  {...register(`${dir}.mapId`)}
                />
                <input
                  style={{ ...input, width: 50 }}
                  type="number"
                  placeholder="X"
                  {...register(`${dir}.tileX`, { valueAsNumber: true })}
                />
                <input
                  style={{ ...input, width: 50 }}
                  type="number"
                  placeholder="Y"
                  {...register(`${dir}.tileY`, { valueAsNumber: true })}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {!selectedId && (
        <div style={field}>
          <label style={label}>{t('map.size')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...input, width: 80 }}
              type="number"
              min={1}
              max={200}
              {...register('cols', { valueAsNumber: true })}
              placeholder={t('map.cols')}
            />
            <input
              style={{ ...input, width: 80 }}
              type="number"
              min={1}
              max={200}
              {...register('rows', { valueAsNumber: true })}
              placeholder={t('map.rows')}
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
            <label style={label}>{t('map.resize')}</label>
            <button
              type="button"
              style={resetBtn}
              onClick={() => setShowResize((v) => !v)}
            >
              {showResize ? t('common.cancel') : t('map.resizeBtn')}
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
                placeholder={t('map.cols')}
              />
              <input
                style={{ ...input, width: 80 }}
                type="number"
                min={1}
                max={200}
                value={resizeRows}
                onChange={(e) => setResizeRows(Number(e.target.value))}
                placeholder={t('map.rows')}
              />
              <button
                type="button"
                style={saveBtn}
                onClick={() => void handleResize()}
              >
                {t('map.apply')}
              </button>
            </div>
          )}
        </div>
      )}

      <button type="submit" style={saveBtn} disabled={!name.trim()}>
        {selectedId ? t('map.save') : t('map.createBtn')}
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

const checkboxField: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: colors.text,
  cursor: 'pointer',
};

const hint: React.CSSProperties = {
  fontSize: 11,
  color: colors.textMuted,
  marginTop: -4,
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
