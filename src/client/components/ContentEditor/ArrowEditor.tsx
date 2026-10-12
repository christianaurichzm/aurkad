import React, { useCallback } from 'react';
import { useForm } from 'react-hook-form';
import {
  fetchArrows,
  createArrow,
  updateArrow,
  deleteArrow,
} from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { SpritePreview } from '../common/SpritePreview';
import { arrowSheet } from '../../io/assets';
import { editorStyles } from '../../theme';
import { useT } from '../../i18n';
import {
  useEntrySelection,
  type EditorGuardProps,
} from '../../hooks/useEntrySelection';

const { container, field, label, input, saveBtn, deleteBtn, ghostBtn } =
  editorStyles;

type ArrowForm = {
  name: string;
  description: string;
  sprite: number;
  damage: number;
  rangeTiles: number;
  tileSpeed: number;
};

const defaults: ArrowForm = {
  name: '',
  description: '',
  sprite: 4,
  damage: 0,
  rangeTiles: 6,
  tileSpeed: 8,
};

export const ArrowEditor: React.FC<EditorGuardProps> = (guard) => {
  const t = useT();
  const {
    formState: { isDirty },
    handleSubmit,
    register,
    reset,
    watch,
  } = useForm<ArrowForm>({ defaultValues: defaults });

  const { selectedId, clear, open, startNew } = useEntrySelection(
    isDirty,
    guard,
    () => reset(defaults),
  );

  const loadOptions = useCallback(async () => {
    const data = await fetchArrows();
    return data.map((a) => ({
      value: String(a.id),
      label: `${a.id} - ${a.name}`,
    }));
  }, []);

  const handleSelect = async (id: string) => {
    if (!(await open(id))) return;
    const arrows = await fetchArrows();
    const a = arrows.find((x) => String(x.id) === id);
    if (a)
      reset({
        name: a.name,
        description: a.description,
        sprite: a.sprite,
        damage: a.damage,
        rangeTiles: a.rangeTiles ?? 6,
        tileSpeed: a.tileSpeed ?? 8,
      });
  };

  const handleSave = async (data: ArrowForm) => {
    const payload = {
      name: data.name,
      description: data.description,
      sprite: data.sprite,
      damage: data.damage,
      rangeTiles: data.rangeTiles,
      tileSpeed: data.tileSpeed,
    };
    const result = selectedId
      ? await updateArrow(Number(selectedId), payload)
          .then(() => true)
          .catch(() => false)
      : !!(await createArrow(payload).catch(() => null));
    chatResultMsg(!!result, t('arrow.saved'), t('arrow.saveError'));
    if (!result) return;
    clear();
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const ok = await deleteArrow(Number(selectedId))
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, t('arrow.deleted'), t('arrow.deleteError'));
    if (!ok) return;
    clear();
  };

  const name = watch('name');

  return (
    <form style={container} onSubmit={handleSubmit(handleSave)}>
      <div style={field}>
        <label style={label}>{t('arrow.arrow')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadOptions}
              value={selectedId}
              onChange={(v) => void handleSelect(v)}
            />
          </div>
          {selectedId && (
            <button
              type="button"
              style={ghostBtn}
              onClick={() => void startNew()}
            >
              {t('editor.new')}
            </button>
          )}
        </div>
      </div>
      <div style={field}>
        <label style={label}>{t('editor.name')}</label>
        <input
          style={input}
          {...register('name')}
          placeholder={t('arrow.namePlaceholder')}
        />
      </div>
      <div style={field}>
        <label style={label}>{t('editor.description')}</label>
        <input style={input} {...register('description')} placeholder="..." />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={field}>
          <label style={label}>{t('editor.sprite')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('sprite', { valueAsNumber: true })}
          />
        </div>
        <SpritePreview
          spriteId={watch('sprite')}
          sheet={arrowSheet}
          tileSize={32}
          size={48}
        />
        <div style={field}>
          <label style={label}>{t('editor.damage')}</label>
          <input
            style={{ ...input, width: 70 }}
            type="number"
            {...register('damage', { valueAsNumber: true })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={field}>
          <label style={label}>{t('arrow.range')}</label>
          <input
            style={{ ...input, width: 90 }}
            type="number"
            {...register('rangeTiles', { valueAsNumber: true })}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('arrow.speed')}</label>
          <input
            style={{ ...input, width: 90 }}
            type="number"
            step="0.5"
            min="1"
            max="30"
            {...register('tileSpeed', { valueAsNumber: true })}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" style={saveBtn} disabled={!name.trim()}>
          {selectedId ? t('common.save') : t('editor.create')}
        </button>
        {selectedId && (
          <button
            type="button"
            style={deleteBtn}
            onClick={() => void handleDelete()}
          >
            {t('common.delete')}
          </button>
        )}
      </div>
    </form>
  );
};
