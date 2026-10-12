import React, { useEffect, useState } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type Control,
} from 'react-hook-form';
import { Dialog } from '../../../shared/types';
import { saveDialog, deleteDialog, fetchDialogRefs } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { Select } from '../common/Select/Select';
import { colors, radius, editorStyles } from '../../theme';
import {
  useEntrySelection,
  type EditorGuardProps,
} from '../../hooks/useEntrySelection';
import { useT } from '../../i18n';

const {
  container,
  field,
  label,
  input,
  box,
  boxHeader,
  entryRow,
  emptyHint,
  warning,
  actions,
  saveBtn,
  deleteBtn,
  ghostBtn,
  addBtn,
  removeBtn,
} = editorStyles;

interface DialogEditorProps extends EditorGuardProps {
  dialogs: Dialog[];
  loadDialogs: () => Promise<{ value: string; label: string }[]>;
  refreshData: () => void;
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

type DialogRefs = { conditions: string[]; actions: string[] };

// `name` or `name:arg`; only the name is what a script provides.
const refName = (ref: string) => ref.trim().split(':')[0];

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
  /** What is registered now; null until known, so nothing is flagged early. */
  refs: DialogRefs | null;
}> = ({ control, nodeIndex, register, nodeOptions, refs }) => {
  const t = useT();
  const choices = useFieldArray({
    control,
    name: `nodes.${nodeIndex}.choices` as const,
  });
  const rows = useWatch({
    control,
    name: `nodes.${nodeIndex}.choices` as const,
  });

  // A reference whose module is off stays in the document untouched, so
  // turning the module back on revives the choice; it is only pointed out.
  const unavailable = (row: ChoiceRow | undefined): string[] => {
    if (!refs || !row) return [];
    return [
      [row.condition, refs.conditions] as const,
      [row.action, refs.actions] as const,
    ]
      .filter(([ref, names]) => ref.trim() && !names.includes(refName(ref)))
      .map(([ref]) => refName(ref));
  };

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
        <React.Fragment key={field.id}>
          <div style={entryRow}>
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
                list="dialog-conditions"
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
                list="dialog-actions"
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
          {unavailable(rows?.[i]).map((name) => (
            <p key={name} style={warning}>
              {t('dialog.refUnavailable', { name })}
            </p>
          ))}
        </React.Fragment>
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
  ...guard
}) => {
  const t = useT();
  const {
    control,
    formState: { isDirty },
    handleSubmit,
    register,
    reset: resetForm,
    watch,
  } = useForm<DialogFormValues>({ defaultValues });

  const nodes = useFieldArray({ control, name: 'nodes' });
  const [refs, setRefs] = useState<DialogRefs | null>(null);

  useEffect(() => {
    let active = true;
    fetchDialogRefs()
      .then((list) => {
        if (active) setRefs(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const watchedNodes = watch('nodes');

  const { selectedId, clear, open, startNew } = useEntrySelection(
    isDirty,
    guard,
    () => resetForm(defaultValues),
  );

  const nodeOptions = watchedNodes
    .map((node) => node.id)
    .filter((id) => id.trim())
    .map((id) => ({ value: id, label: id }));

  const selectDialog = async (id: string) => {
    if (!(await open(id))) return;
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
    if (!result) return;
    refreshData();
    clear();
  };

  const remove = async () => {
    if (!selectedId) return;
    const ok = await deleteDialog(selectedId)
      .then(() => true)
      .catch(() => false);
    chatResultMsg(ok, t('dialog.deleted'), t('dialog.deleteError'));
    if (!ok) return;
    refreshData();
    clear();
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
              refs={refs}
            />
          </div>
        ))}
      </div>

      <datalist id="dialog-conditions">
        {refs?.conditions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      <datalist id="dialog-actions">
        {refs?.actions.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>

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
