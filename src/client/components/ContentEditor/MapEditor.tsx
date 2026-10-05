import React, { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import {
  MapStateClient,
  MapType,
  MapOrientation,
  type BorderLink,
  type Position,
} from '../../../shared/types';
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

// `position` sends the whole edge to one tile. The editor makes none but
// keeps a loaded one until it is cleared.
type BorderLinkForm = { mapId: string; offset: number; position?: Position };
type MapFormValues = {
  name: string;
  type: MapType;
  orientation: MapOrientation;
  cols: number;
  rows: number;
  music: string;
  instanced: boolean;
  borderUp: BorderLinkForm;
  borderDown: BorderLinkForm;
  borderLeft: BorderLinkForm;
  borderRight: BorderLinkForm;
};

const emptyBorder: BorderLinkForm = { mapId: '', offset: 0 };

const BORDER_LABEL: Record<string, TranslationKey> = {
  borderUp: 'map.borderUp',
  borderDown: 'map.borderDown',
  borderLeft: 'map.borderLeft',
  borderRight: 'map.borderRight',
};

const defaultValues: MapFormValues = {
  name: '',
  type: 'normal',
  orientation: 'orthogonal',
  cols: 20,
  rows: 14,
  music: '',
  instanced: false,
  borderUp: emptyBorder,
  borderDown: emptyBorder,
  borderLeft: emptyBorder,
  borderRight: emptyBorder,
};

// A new map takes the orientation most of the game's maps have.
const newMapValues = (maps: MapStateClient[]): MapFormValues => {
  const isometric = maps.filter((m) => m.orientation === 'isometric').length;
  return {
    ...defaultValues,
    orientation: isometric * 2 > maps.length ? 'isometric' : 'orthogonal',
  };
};

function linkToForm(link?: BorderLink): BorderLinkForm {
  if (!link) return emptyBorder;
  return {
    mapId: link.to,
    offset: link.offset ?? 0,
    ...(link.position && { position: link.position }),
  };
}

const mapToFormValues = (map: MapStateClient): MapFormValues => ({
  name: map.name ?? '',
  type: map.type ?? 'normal',
  orientation: map.orientation ?? 'orthogonal',
  cols: map.tiles?.[0]?.length ?? 20,
  rows: map.tiles?.length ?? 14,
  music: map.music ?? '',
  instanced: map.instanced ?? false,
  borderUp: linkToForm(map.borderLinks?.up),
  borderDown: linkToForm(map.borderLinks?.down),
  borderLeft: linkToForm(map.borderLinks?.left),
  borderRight: linkToForm(map.borderLinks?.right),
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
    setValue,
    watch,
  } = useForm<MapFormValues>({ defaultValues: newMapValues(maps) });

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
    resetForm(newMapValues(maps));
  };

  const buildLink = (b: BorderLinkForm): BorderLink | undefined => {
    if (!b.mapId) return undefined;
    const offset = Number.isFinite(b.offset) ? Math.round(b.offset) : 0;
    return {
      to: b.mapId,
      ...(offset !== 0 && { offset }),
      ...(b.position && { position: b.position }),
    };
  };

  const handleSave = async ({
    name,
    type,
    orientation,
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
      up: buildLink(borderUp),
      down: buildLink(borderDown),
      left: buildLink(borderLeft),
      right: buildLink(borderRight),
    };
    const result = selectedId
      ? await updateMap(selectedId, {
          name,
          type,
          orientation,
          music: music || undefined,
          instanced,
          borderLinks,
        })
      : await createMap({ name, type, orientation, cols, rows });
    chatResultMsg(!!result, t('map.saved'), t('map.saveError'));
    refreshData();
    setSelectedId('');
    setShowResize(false);
    resetForm(newMapValues(maps));
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

      <div style={field}>
        <label style={label} htmlFor="mapOrientation">
          {t('map.orientation')}
        </label>
        <select id="mapOrientation" style={input} {...register('orientation')}>
          <option value="orthogonal">{t('map.orthogonal')}</option>
          <option value="isometric">{t('map.isometric')}</option>
        </select>
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
            ).map((dir) => {
              const fixed = watch(`${dir}.position`);
              return (
                <div
                  key={dir}
                  style={{
                    display: 'flex',
                    gap: 6,
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ ...label, width: 64, marginBottom: 0 }}>
                    {t(BORDER_LABEL[dir] ?? 'map.borderUp')}
                  </span>
                  <select
                    style={{ ...input, flex: 2 }}
                    aria-label={t(BORDER_LABEL[dir] ?? 'map.borderUp')}
                    {...register(`${dir}.mapId`)}
                  >
                    <option value="">{t('map.borderNone')}</option>
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id} - {m.name}
                      </option>
                    ))}
                  </select>
                  {fixed ? (
                    <button
                      type="button"
                      style={resetBtn}
                      title={t('map.borderFixedHint')}
                      onClick={() =>
                        setValue(`${dir}.position`, undefined, {
                          shouldDirty: true,
                        })
                      }
                    >
                      {t('map.borderFixed', {
                        x: Math.round(fixed.x / TILE_SIZE),
                        y: Math.round(fixed.y / TILE_SIZE),
                      })}
                    </button>
                  ) : (
                    <input
                      style={{ ...input, width: 64 }}
                      type="number"
                      step={1}
                      aria-label={t('map.borderOffset')}
                      title={t('map.borderOffset')}
                      {...register(`${dir}.offset`, { valueAsNumber: true })}
                    />
                  )}
                </div>
              );
            })}
            <span style={hint}>{t('map.borderHint')}</span>
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
  borderRadius: radius.control,
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
  borderRadius: radius.control,
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
  borderRadius: radius.control,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
};
