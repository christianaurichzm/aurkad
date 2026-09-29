import React, { useCallback, useEffect, useState } from 'react';
import {
  defaultParamValue,
  isNumericParam,
  type ScriptBehaviorDescriptor,
  type ScriptBehaviorEvent,
  type ScriptParams,
  type ScriptParamSpec,
  type ScriptParamValue,
} from '../../../shared/scriptParams';
import { fetchBehaviors } from '../../io/network';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { Select } from '../common/Select/Select';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

type OptionLoader<T extends string | number> = () => Promise<
  { value: T; label: string }[]
>;

interface ScriptBehaviorFieldsProps {
  /** Only behaviours implementing one of these can run on this content. */
  events: ScriptBehaviorEvent[];
  scriptId: string;
  onScriptIdChange: (scriptId: string) => void;
  params: ScriptParams;
  onParamsChange: (params: ScriptParams) => void;
  /** What running it means here ("runs when the item is used"). */
  hint?: string;
  /** Gives an `item` param the editor's item picker, when the host has one. */
  loadItems?: OptionLoader<number>;
  /** Same for `npc` params. */
  loadNpcs?: OptionLoader<string>;
}

/**
 * The script behavior dropdown plus one field per param the behaviour
 * exports. The saved id is always an option, so scripts that failed to load
 * cannot erase the wiring of content edited for something else.
 */
export const ScriptBehaviorFields: React.FC<ScriptBehaviorFieldsProps> = ({
  events,
  scriptId,
  onScriptIdChange,
  params,
  onParamsChange,
  hint,
  loadItems,
  loadNpcs,
}) => {
  const t = useT();
  const [behaviors, setBehaviors] = useState<ScriptBehaviorDescriptor[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBehaviors()
      .then((list) => {
        if (active) setBehaviors(list);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = behaviors.find((b) => b.id === scriptId);
  const usable = behaviors.filter((b) =>
    b.events.some((event) => events.includes(event)),
  );

  const options = [
    { value: '', label: t('editor.none') },
    ...usable.map((b) => ({ value: b.id, label: `${b.id} - ${b.owner}` })),
    // A behaviour that cannot run here is offered with the reason, rather than
    // looking like it was never written.
    ...behaviors
      .filter((b) => !usable.includes(b))
      .map((b) => ({
        value: b.id,
        label: t('behavior.noHandler', { id: b.id }),
      })),
  ];
  if (scriptId && !behaviors.some((b) => b.id === scriptId)) {
    options.push({
      value: scriptId,
      label: t('behavior.notRegistered', { id: scriptId }),
    });
  }

  const setParam = useCallback(
    (key: string, value: ScriptParamValue | undefined) => {
      const next = { ...params };
      // Absent rather than empty, so the declared default applies, which is
      // what the field already shows.
      if (value === undefined || value === '') delete next[key];
      else next[key] = value;
      onParamsChange(next);
    },
    [params, onParamsChange],
  );

  const selectBehavior = (id: string) => {
    onScriptIdChange(id);
    // Params belong to the behaviour that declared them; a switch clears them.
    if (id !== scriptId) onParamsChange({});
  };

  return (
    <div style={box}>
      <label style={label} title={hint}>
        {t('behavior.title')}
      </label>
      <Select options={options} value={scriptId} onChange={selectBehavior} />
      {loadFailed && <p style={warning}>{t('behavior.loadFailed')}</p>}
      {scriptId && !selected && !loadFailed && (
        <p style={warning}>{t('behavior.unregistered', { id: scriptId })}</p>
      )}
      {selected && selected.params.length === 0 && (
        <p style={note}>{t('behavior.noParams', { owner: selected.owner })}</p>
      )}

      {selected?.params.map((spec) => (
        <ParamField
          key={spec.key}
          spec={spec}
          value={params[spec.key]}
          onChange={(value) => setParam(spec.key, value)}
          loadItems={loadItems}
          loadNpcs={loadNpcs}
        />
      ))}
    </div>
  );
};

interface ParamFieldProps {
  spec: ScriptParamSpec;
  value: ScriptParamValue | undefined;
  onChange: (value: ScriptParamValue | undefined) => void;
  loadItems?: OptionLoader<number>;
  loadNpcs?: OptionLoader<string>;
}

const ParamField: React.FC<ParamFieldProps> = ({
  spec,
  value,
  onChange,
  loadItems,
  loadNpcs,
}) => {
  // Shown, not stored: the runtime applies the same default.
  const shown = value ?? defaultParamValue(spec);
  const title = spec.help;

  const heading = (
    <label style={paramLabel} title={title}>
      {spec.label ?? spec.key}
      {spec.required && <span style={requiredMark}> *</span>}
    </label>
  );

  if (spec.type === 'boolean') {
    return (
      <label style={checkboxRow} title={title}>
        <input
          type="checkbox"
          checked={shown === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        {spec.label ?? spec.key}
      </label>
    );
  }

  if (spec.type === 'select') {
    return (
      <div style={paramField}>
        {heading}
        <Select
          options={(spec.options ?? []).map((o) => ({ value: o, label: o }))}
          value={String(shown)}
          onChange={onChange}
        />
      </div>
    );
  }

  if (spec.type === 'item' && loadItems) {
    return (
      <div style={paramField}>
        {heading}
        <AsyncSelect<number>
          loadOptions={loadItems}
          value={Number(shown) || 0}
          onChange={(id) => onChange(id || undefined)}
        />
      </div>
    );
  }

  if (spec.type === 'npc' && loadNpcs) {
    return (
      <div style={paramField}>
        {heading}
        <AsyncSelect<string>
          loadOptions={loadNpcs}
          value={String(shown)}
          onChange={(id) => onChange(id || undefined)}
        />
      </div>
    );
  }

  if (isNumericParam(spec.type)) {
    return (
      <div style={paramField}>
        {heading}
        <input
          style={input}
          type="number"
          value={String(shown)}
          min={spec.min}
          max={spec.max}
          onChange={(e) =>
            onChange(e.target.value === '' ? undefined : Number(e.target.value))
          }
        />
      </div>
    );
  }

  return (
    <div style={paramField}>
      {heading}
      <input
        style={input}
        type="text"
        value={String(shown)}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
};

const box: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  padding: '10px 12px',
};

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
};

const paramField: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
};

const paramLabel: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
};

const requiredMark: React.CSSProperties = { color: colors.danger };

const checkboxRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: colors.textMuted,
};

const input: React.CSSProperties = {
  padding: '6px 8px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
  background: colors.surface,
};

const note: React.CSSProperties = {
  fontSize: 12,
  color: colors.textMuted,
  margin: 0,
};

const warning: React.CSSProperties = {
  fontSize: 12,
  color: colors.dangerText,
  margin: 0,
};
