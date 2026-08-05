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
  const choices = useFieldArray({
    control,
    name: `nodes.${nodeIndex}.choices` as const,
  });

  return (
    <div style={choiceBox}>
      <div style={boxHeader}>
        <span style={label}>Choices</span>
        <button
          type="button"
          style={addBtn}
          onClick={() => choices.append(newChoice())}
        >
          + Add
        </button>
      </div>
      {choices.fields.length === 0 && (
        <p style={emptyHint}>
          No choices: the player gets a single Continue and the conversation
          ends here.
        </p>
      )}
      {choices.fields.map((field, i) => (
        <div key={field.id} style={choiceRow}>
          <div style={{ flex: 2, minWidth: 0 }}>
            <label style={label}>Label</label>
            <input
              style={input}
              placeholder="Yes, I'll help"
              {...register(`nodes.${nodeIndex}.choices.${i}.label` as const)}
            />
          </div>
          <div style={{ flex: 1.4, minWidth: 0 }}>
            <label
              style={label}
              title="Node this choice leads to. Ends the conversation when left as End."
            >
              Goes to
            </label>
            <Controller
              control={control}
              name={`nodes.${nodeIndex}.choices.${i}.next` as const}
              render={({ field: next }) => (
                <Select
                  options={withCurrent(nodeOptions, next.value)}
                  value={next.value}
                  onChange={next.onChange}
                />
              )}
            />
          </div>
          <div style={{ flex: 1.2, minWidth: 0 }}>
            <label
              style={label}
              title="Name of a predicate a script registered with provide('dialogCondition.<name>'). Leave empty to always offer this choice. A choice whose condition says no is not shown at all."
            >
              Condition
            </label>
            <input
              style={input}
              placeholder="none"
              {...register(
                `nodes.${nodeIndex}.choices.${i}.condition` as const,
              )}
            />
          </div>
          <div style={{ flex: 1.2, minWidth: 0 }}>
            <label
              style={label}
              title="Name of a handler a script registered with provide('dialogAction.<name>'), run when this choice is picked. If it is missing or throws, the conversation stops instead of moving on."
            >
              Action
            </label>
            <input
              style={input}
              placeholder="none"
              {...register(`nodes.${nodeIndex}.choices.${i}.action` as const)}
            />
          </div>
          <button
            type="button"
            style={removeBtn}
            onClick={() => choices.remove(i)}
            title="Remove"
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
): { value: string; label: string }[] =>
  value && !options.some((o) => o.value === value)
    ? [...options, { value, label: `${value} (missing)` }]
    : options;

export const DialogEditor: React.FC<DialogEditorProps> = ({
  dialogs,
  loadDialogs,
  refreshData,
  onDirtyChange,
  requestDiscard,
}) => {
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
    chatResultMsg(!!result, 'Dialog saved!', 'Error saving dialog');
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
    chatResultMsg(true, 'Dialog deleted!', 'Error deleting dialog');
    refreshData();
    setSelectedId('');
    resetForm(defaultValues);
  };

  return (
    <form style={container} onSubmit={handleSubmit(save)}>
      <div style={field}>
        <label style={label}>Dialog</label>
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
              New
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={field}>
          <label style={label}>ID</label>
          <input
            style={{ ...input, ...(selectedId ? { opacity: 0.5 } : {}) }}
            {...register('id')}
            placeholder="elder-intro"
            readOnly={!!selectedId}
          />
        </div>
        <div style={field}>
          <label style={label}>Name</label>
          <input
            style={input}
            {...register('name')}
            placeholder="Village elder - intro"
          />
        </div>
      </div>

      <div style={field}>
        <label
          style={label}
          title="Node the conversation opens on. Defaults to the first one."
        >
          Starts at
        </label>
        <Controller
          control={control}
          name="start"
          render={({ field: start }) => (
            <Select
              options={withCurrent(
                [{ value: '', label: 'First node' }, ...nodeOptions],
                start.value,
              )}
              value={start.value}
              onChange={start.onChange}
            />
          )}
        />
      </div>

      <div style={box}>
        <div style={boxHeader}>
          <span style={label}>Nodes</span>
          <button
            type="button"
            style={addBtn}
            onClick={() => nodes.append(newNode(nodes.fields.length))}
          >
            + Add node
          </button>
        </div>
        {nodes.fields.length === 0 && (
          <p style={emptyHint}>
            No nodes yet. Add one: its text is what the NPC says, and its
            choices are what the player can answer.
          </p>
        )}
        {nodes.fields.map((nodeField, index) => (
          <div key={nodeField.id} style={nodeCard}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ width: 140, flexShrink: 0 }}>
                <label style={label}>Node ID</label>
                <input
                  style={input}
                  {...register(`nodes.${index}.id` as const)}
                  placeholder="greet"
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <label style={label}>Text</label>
                <textarea
                  style={{ ...input, minHeight: 46, resize: 'vertical' }}
                  {...register(`nodes.${index}.text` as const)}
                  placeholder="Welcome, traveller."
                />
              </div>
              <button
                type="button"
                style={removeBtn}
                onClick={() => nodes.remove(index)}
                title="Remove node"
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
          {selectedId ? 'Save dialog' : 'Create dialog'}
        </button>
        {selectedId && (
          <button type="button" style={deleteBtn} onClick={() => void remove()}>
            Delete
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
  borderRadius: radius.sm,
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
  borderRadius: radius.md,
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const nodeCard: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
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
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};
const deleteBtn: React.CSSProperties = {
  background: colors.danger,
  color: '#fff',
  border: 'none',
  padding: '9px 14px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};
const ghostBtn: React.CSSProperties = {
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
const addBtn: React.CSSProperties = {
  background: 'transparent',
  color: colors.primary,
  border: `1px solid ${colors.primary}`,
  padding: '3px 10px',
  borderRadius: radius.sm,
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
