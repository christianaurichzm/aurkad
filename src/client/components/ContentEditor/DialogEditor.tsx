import React, { useEffect, useState } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  type Control,
} from 'react-hook-form';
import { Dialog } from '../../../shared/types';
import { saveDialog, deleteDialog } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { Select } from '../common/Select/Select';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

interface DialogEditorProps {
  dialogs: Dialog[];
  loadDialogs: () => Promise<{ value: string; label: string }[]>;
  refreshData: () => void;
  onDirtyChange: (dirty: boolean) => void;
  requestDiscard: () => Promise<boolean>;
}

// Empty strings rather than undefined: a react-hook-form input is controlled,
// and the optional fields are folded back out on save.
type ChoiceRow = {
  label: string;
  next: string;
  condition: string;
  action: string;
};

type NodeRow = {
  id: string;
  text: string;
  choices: ChoiceRow[];
};

type DialogFormValues = {
  id: string;
  name: string;
  start: string;
  nodes: NodeRow[];
};

const defaultValues: DialogFormValues = {
  id: '',
  name: '',
  start: '',
  nodes: [],
};

const dialogToForm = (dialog: Dialog): DialogFormValues => ({
  id: dialog.id,
  name: dialog.name,
  start: dialog.start ?? '',
  nodes: dialog.nodes.map((node) => ({
    id: node.id,
    text: node.text,
    choices: (node.choices ?? []).map((choice) => ({
      label: choice.label,
      next: choice.next ?? '',
      condition: choice.condition ?? '',
      action: choice.action ?? '',
    })),
  })),
});

const newNode = (index: number): NodeRow => ({
  id: `node${index + 1}`,
  text: '',
  choices: [],
});

const newChoice = (): ChoiceRow => ({
  label: '',
  next: '',
  condition: '',
  action: '',
});

/**
 * The choices of one node, in its own component since a nested field
 * array needs its own hook call.
 */
const NodeChoices: React.FC<{
  control: Control<DialogFormValues>;
  nodeIndex: number;
  register: ReturnType<typeof useForm<DialogFormValues>>['register'];
  nodeOptions: { value: string; label: string }[];
}> = ({ control, nodeIndex, register, nodeOptions }) => {
  const t = useT();
  const choices = useFieldArray({
    control,
    name: `nodes.${nodeIndex}.choices` as const,
  });

  return (
    <div style={choiceBox}>
      <div style={boxHeader}>
        <span style={label}>{t('dialog.choices')}</span>
        <button
          type="button"
          style={addBtn}
          onClick={() => choices.append(newChoice())}
        >
          {t('editor.add')}
        </button>
      </div>
      {choices.fields.length === 0 && (
        <p style={emptyHint}>{t('dialog.noChoices')}</p>
      )}
      {choices.fields.map((field, i) => (
        <div key={field.id} style={choiceRow}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <label style={label}>{t('dialog.label')}</label>
            <input
              style={input}
              placeholder={t('dialog.labelPlaceholder')}
              {...register(`nodes.${nodeIndex}.choices.${i}.label` as const)}
            />
          </div>
          <div style={{ flex: 1.4, minWidth: 0 }}>
            <label style={label} title={t('dialog.goesToHelp')}>
              {t('dialog.goesTo')}
            </label>
            <Controller
              control={control}
              name={`nodes.${nodeIndex}.choices.${i}.next` as const}
              render={({ field: next }) => (
                <Select
                  options={withCurrent(
                    nodeOptions,
                    next.value,
                    t('dialog.missing', { id: next.value }),
                  )}
                  value={next.value}
                  onChange={next.onChange}
                />
              )}
            />
          </div>
          <div style={{ flex: 1.2, minWidth: 0 }}>
            <label style={label} title={t('dialog.conditionHelp')}>
              {t('loot.condition')}
            </label>
            <input
              style={input}
              placeholder={t('loot.conditionNone')}
              {...register(
                `nodes.${nodeIndex}.choices.${i}.condition` as const,
              )}
            />
          </div>
          <div style={{ flex: 1.2, minWidth: 0 }}>
            <label style={label} title={t('dialog.actionHelp')}>
              {t('dialog.action')}
            </label>
            <input
              style={input}
              placeholder={t('loot.conditionNone')}
              {...register(`nodes.${nodeIndex}.choices.${i}.action` as const)}
            />
          </div>
          <button
            type="button"
            style={removeBtn}
            onClick={() => choices.remove(i)}
            title={t('editor.remove')}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
};

/**
 * Keeps a saved value selectable when it is not in the list, so a link is
 * never dropped silently on the next save.
 */
const withCurrent = (
  options: { value: string; label: string }[],
  value: string,
  missingLabel: string,
): { value: string; label: string }[] =>
  value && !options.some((o) => o.value === value)
    ? [...options, { value, label: missingLabel }]
    : options;

export const DialogEditor: React.FC<DialogEditorProps> = ({
  dialogs,
  loadDialogs,
  refreshData,
  onDirtyChange,
  requestDiscard,
}) => {
  const t = useT();
  const [selectedId, setSelectedId] = useState('');
  const {
    control,
    formState: { isDirty },
    handleSubmit,
    register,
    reset: resetForm,
    watch,
  } = useForm<DialogFormValues>({ defaultValues });

  const nodes = useFieldArray({ control, name: 'nodes' });
  const watchedNodes = watch('nodes');

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  const nodeOptions = watchedNodes
    .map((node) => node.id)
    .filter((id) => id.trim())
    .map((id) => ({ value: id, label: id }));

  const reset = async () => {
    if (!(await requestDiscard())) return;
    setSelectedId('');
    resetForm(defaultValues);
  };

  const selectDialog = async (id: string) => {
    if (!(await requestDiscard())) return;
    setSelectedId(id);
    const dialog = dialogs.find((d) => d.id === id);
    if (dialog) resetForm(dialogToForm(dialog));
  };

  const save = async (values: DialogFormValues) => {
    const dialog: Dialog = {
      id: values.id,
      name: values.name,
      // Omitted when empty, so the document keeps meaning "the first node".
      ...(values.start.trim() ? { start: values.start.trim() } : {}),
      nodes: values.nodes.map((node) => ({
        id: node.id.trim(),
        text: node.text,
        // A node that ends the conversation has no `choices` key, so the
        // document does not grow on every round trip.
        ...(node.choices.length > 0
          ? {
              choices: node.choices.map((choice) => ({
                label: choice.label,
                ...(choice.next.trim() ? { next: choice.next.trim() } : {}),
                ...(choice.condition.trim()
                  ? { condition: choice.condition.trim() }
                  : {}),
                ...(choice.action.trim()
                  ? { action: choice.action.trim() }
                  : {}),
              })),
            }
          : {}),
      })),
    };
    const result = await saveDialog(dialog).catch(() => null);
    chatResultMsg(!!result, t('dialog.saved'), t('dialog.saveError'));
    for (const warning of result?.warnings ?? []) {
      chatResultMsg(false, '', warning);
    }
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  const remove = async () => {
    if (!selectedId) return;
    await deleteDialog(selectedId);
    chatResultMsg(true, t('dialog.deleted'), t('dialog.deleteError'));
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  return (
    <form style={container} onSubmit={handleSubmit(save)}>
      <div style={field}>
        <label style={label}>{t('npc.dialog')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadDialogs}
              value={selectedId}
              onChange={(id) => void selectDialog(id)}
            />
          </div>
          {selectedId && (
            <button type="button" style={ghostBtn} onClick={() => void reset()}>
              {t('editor.new')}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={field}>
          <label style={label}>{t('editor.id')}</label>
          <input
            style={{ ...input, ...(selectedId ? { opacity: 0.5 } : {}) }}
            {...register('id')}
            placeholder={t('dialog.idPlaceholder')}
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>{t('editor.name')}</label>
          <input
            style={input}
            {...register('name')}
            placeholder={t('dialog.namePlaceholder')}
          />
        </div>
      </div>

      <div style={field}>
        <label style={label} title={t('dialog.startsAtHelp')}>
          {t('dialog.startsAt')}
        </label>
        <Controller
          control={control}
          name="start"
          render={({ field: start }) => (
            <Select
              options={withCurrent(
                [{ value: '', label: t('dialog.firstNode') }, ...nodeOptions],
                start.value,
                t('dialog.missing', { id: start.value }),
              )}
              value={start.value}
              onChange={start.onChange}
            />
          )}
        />
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>{t('dialog.nodes')}</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => nodes.append(newNode(nodes.fields.length))}
          >
            {t('dialog.addNode')}
          </button>
        </div>
        {nodes.fields.length === 0 && (
          <p style={emptyHint}>{t('dialog.noNodes')}</p>
        )}
        {nodes.fields.map((nodeField, index) => (
          <div key={nodeField.id} style={nodeCard}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ width: 140, flexShrink: 0 }}>
                <label style={label}>{t('dialog.nodeId')}</label>
                <input
                  style={input}
                  {...register(`nodes.${index}.id` as const)}
                  placeholder={t('dialog.nodeIdPlaceholder')}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>{t('dialog.text')}</label>
                <textarea
                  style={{ ...input, minHeight: 46, resize: 'vertical' }}
                  {...register(`nodes.${index}.text` as const)}
                  placeholder={t('dialog.textPlaceholder')}
                />
              </div>
              <button
                type="button"
                style={removeBtn}
                onClick={() => nodes.remove(index)}
                title={t('dialog.removeNode')}
              >
                ✕
              </button>
            </div>
            <NodeChoices
              control={control}
              nodeIndex={index}
              register={register}
              nodeOptions={nodeOptions}
            />
          </div>
        ))}
      </div>

      <div style={actions}>
        <button type="submit" style={saveBtn}>
          {selectedId ? t('dialog.save') : t('dialog.createBtn')}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={() => void remove()}>
            {t('common.delete')}
          </button>
        )}
      </div>
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
  fontFamily: 'inherit',
};
const box: React.CSSProperties = {
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const nodeCard: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const choiceBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};
const boxHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const choiceRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-end',
};
const emptyHint: React.CSSProperties = {
  fontSize: 13,
  color: colors.textMuted,
  margin: 0,
};
const actions: React.CSSProperties = { display: 'flex', gap: 8 };
const saveBtn: React.CSSProperties = {
  flex: 1,
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '9px 16px',
  borderRadius: radius.control,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};
const deleteBtn: React.CSSProperties = {
  background: colors.danger,
  color: '#fff',
  border: 'none',
  padding: '9px 14px',
  borderRadius: radius.control,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};
const ghostBtn: React.CSSProperties = {
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
const addBtn: React.CSSProperties = {
  background: 'transparent',
  color: colors.info,
  border: `1px solid ${colors.primary}`,
  padding: '3px 10px',
  borderRadius: radius.control,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 12,
};
const removeBtn: React.CSSProperties = {
  background: 'transparent',
  color: colors.textMuted,
  border: 'none',
  padding: '0 4px',
  cursor: 'pointer',
  fontSize: 14,
  alignSelf: 'flex-end',
  paddingBottom: 8,
};
