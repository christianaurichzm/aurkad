// Parameters a named behaviour exports, so content configures it instead
// of the script hard-coding one instance. The declaration lives with the
// code that reads it:
//
//     attach('chest', {
//       params: { itemId: { type: 'item' }, quantity: { type: 'number', default: 1 } },
//       onEnter({ player, params }) { giveItem(player, params.itemId, params.quantity); },
//     });
//
// and the editor renders a field per param on every NPC, item or tile that
// names the behaviour. Shared because the runtime resolves stored values
// and the editor renders a form from the same declaration: both must agree
// on what `{ type: 'number', min: 1 }` means.

import { z } from 'zod';
import { EQUIPMENT_SLOTS } from './constants.js';

/**
 * Field kinds the editor knows how to render.
 *
 * `item`, `npc` and `map` are ids: same storage as number/string, but the
 * editor can offer the existing content pickers instead of asking a designer
 * to remember that the health potion is item 3.
 */
export const SCRIPT_PARAM_TYPES = [
  'text',
  'number',
  'boolean',
  'select',
  'item',
  'npc',
  'map',
] as const;

export type ScriptParamType = (typeof SCRIPT_PARAM_TYPES)[number];

/** Scalars only: they round-trip through JSON, a form and a document. */
export type ScriptParamValue = string | number | boolean;

export type ScriptParams = Record<string, ScriptParamValue>;

export interface ScriptParamSpec {
  key: string;
  type: ScriptParamType;
  /** Field label in the editor. Falls back to the key. */
  label?: string;
  /** Longer explanation, rendered as help text next to the field. */
  help?: string;
  /** Content with no value for this param is reported by validation. */
  required?: boolean;
  default?: ScriptParamValue;
  /** `number` only. Values outside the range are clamped at dispatch. */
  min?: number;
  max?: number;
  /** `select` only, and non-empty: the allowed values. */
  options?: string[];
  /**
   * `select` only: what the editor shows for each option, in the same order.
   * For values that are ids: the stored value stays the id, so renaming the
   * thing it points at breaks nothing.
   */
  optionLabels?: string[];
}

/** Dispatch points a behaviour can implement, in the editors' order. */
export const SCRIPT_BEHAVIOR_EVENTS = [
  'onEnter',
  'onInteract',
  'onDeath',
  'onUse',
  'onEquip',
  'onUnequip',
] as const;

export type ScriptBehaviorEvent = (typeof SCRIPT_BEHAVIOR_EVENTS)[number];

/**
 * Behaviour events an item of this type can reach. The type decides: a
 * consumable is spent by use, equipment is put on and taken off, and money
 * dispatches nothing. Shared so the item editor offers only behaviours
 * that can run, and the save path warns about one that cannot, instead of
 * keeping one that silently stops firing.
 */
export function itemBehaviorEvents(
  type: string | undefined,
): ScriptBehaviorEvent[] {
  if (type === 'consumable') return ['onUse'];
  if ((EQUIPMENT_SLOTS as readonly string[]).includes(type ?? '')) {
    return ['onEquip', 'onUnequip'];
  }
  return [];
}

/**
 * A registered behaviour as the content editors see it (`GET /behaviors`).
 *
 * `events` is what lets an editor offer only the behaviours that can run on the
 * content being edited: a consumable can only ever reach `onUse`.
 */
export interface ScriptBehaviorDescriptor {
  id: string;
  /** Script file that registered it, so the editor can say where it lives. */
  owner: string;
  events: ScriptBehaviorEvent[];
  params: ScriptParamSpec[];
}

/**
 * Bounds on what content may store. A declaration is no permission to write
 * anything: the values come from an HTTP body into a Mixed Mongoose field
 * loaded on every content read. As persistence/dataLimits.ts, smaller: a
 * param is one form field, so a few hundred bytes is generous.
 */
export const SCRIPT_PARAM_LIMITS = {
  maxKeys: 32,
  maxKeyLength: 64,
  maxStringLength: 512,
} as const;

function isParamType(value: unknown): value is ScriptParamType {
  return (
    typeof value === 'string' &&
    (SCRIPT_PARAM_TYPES as readonly string[]).includes(value)
  );
}

/** Whether a param of this type holds a number rather than a string. */
export function isNumericParam(type: ScriptParamType): boolean {
  return type === 'number' || type === 'item' || type === 'npc';
}

/** The value a form field starts at when content has none stored yet. */
export function defaultParamValue(spec: ScriptParamSpec): ScriptParamValue {
  if (spec.default !== undefined) return spec.default;
  if (spec.type === 'boolean') return false;
  if (isNumericParam(spec.type)) return 0;
  if (spec.type === 'select') return spec.options?.[0] ?? '';
  return '';
}

function coerce(
  spec: ScriptParamSpec,
  raw: unknown,
): ScriptParamValue | undefined {
  if (raw === null || raw === undefined) return undefined;

  if (spec.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    // A checkbox that round-tripped through a query string or an older
    // document arrives as a string; treating "false" as truthy would invert it.
    if (raw === 'true' || raw === 1) return true;
    if (raw === 'false' || raw === 0) return false;
    return undefined;
  }

  if (isNumericParam(spec.type)) {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) return undefined;
    // Clamped rather than refused: the editor already validates, and a
    // behaviour asked for a range so it can assume one at dispatch.
    if (spec.min !== undefined && n < spec.min) return spec.min;
    if (spec.max !== undefined && n > spec.max) return spec.max;
    return n;
  }

  // Only a primitive becomes a string worth storing. An object, a function or
  // a symbol stringifies to something nobody authored ([object Object], source
  // text, Symbol(x)), so it is refused rather than written back looking real.
  if (
    typeof raw !== 'string' &&
    typeof raw !== 'number' &&
    typeof raw !== 'boolean' &&
    typeof raw !== 'bigint'
  ) {
    return undefined;
  }
  const s = String(raw);
  if (spec.type === 'select') {
    return spec.options?.includes(s) ? s : undefined;
  }
  return s;
}

export interface ResolvedScriptParams {
  params: ScriptParams;
  /** Declared `required` params content left empty, for the caller. */
  missing: string[];
}

/**
 * The object a handler receives as `ctx.params`. Undeclared keys are dropped
 * and declared ones coerced to their type, so `params.quantity` reads as a
 * number whatever a form or document stored. A value that cannot be coerced
 * falls back to the default, then the type's empty value, never the raw
 * input, which would defeat declaring a type.
 */
export function resolveScriptParams(
  specs: readonly ScriptParamSpec[],
  stored: Readonly<Record<string, unknown>> | undefined,
): ResolvedScriptParams {
  const params: ScriptParams = {};
  const missing: string[] = [];

  for (const spec of specs) {
    const raw = stored?.[spec.key];
    const value = coerce(spec, raw) ?? coerce(spec, spec.default);
    if (value === undefined) {
      if (spec.required) missing.push(spec.key);
      // Not defaulted to the type's empty value: `params.itemId === 0` reads
      // as "item 0" and would hand a wrong id to giveItem, where undefined
      // makes the failure visible at the call it reaches.
      continue;
    }
    params[spec.key] = value;
  }

  return { params, missing };
}

/**
 * Validates a `params` declaration coming from script code. Returns the
 * specs in declaration order (the editor's order) plus a message per
 * problem, and any message is fatal for the whole declaration: a param the
 * editor cannot render is a field nobody can fill, read as undefined with
 * nothing saying why.
 */
export function normalizeParamSpecs(raw: unknown): {
  specs: ScriptParamSpec[];
  errors: string[];
} {
  const specs: ScriptParamSpec[] = [];
  const errors: string[] = [];

  if (raw === undefined) return { specs, errors };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { specs, errors: ['params must be an object keyed by param name'] };
  }

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || key.length > SCRIPT_PARAM_LIMITS.maxKeyLength) {
      errors.push(
        `param name "${key}" must be 1-${SCRIPT_PARAM_LIMITS.maxKeyLength} characters`,
      );
      continue;
    }
    if (typeof value !== 'object' || value === null) {
      errors.push(`param "${key}" must be an object, e.g. { type: 'number' }`);
      continue;
    }

    const decl = value as Record<string, unknown>;
    const type = decl['type'];
    if (!isParamType(type)) {
      errors.push(
        `param "${key}" has unknown type ${JSON.stringify(type)}; expected one of ${SCRIPT_PARAM_TYPES.join(', ')}`,
      );
      continue;
    }

    const spec: ScriptParamSpec = { key, type };
    if (typeof decl['label'] === 'string') spec.label = decl['label'];
    if (typeof decl['help'] === 'string') spec.help = decl['help'];
    if (decl['required'] === true) spec.required = true;

    if (type === 'select') {
      const options = decl['options'];
      if (
        !Array.isArray(options) ||
        options.length === 0 ||
        options.some((o) => typeof o !== 'string')
      ) {
        errors.push(
          `param "${key}" is a select and needs a non-empty options array of strings`,
        );
        continue;
      }
      spec.options = options as string[];
      const labels = decl['optionLabels'];
      if (labels !== undefined) {
        if (
          !Array.isArray(labels) ||
          labels.length !== options.length ||
          labels.some((l) => typeof l !== 'string')
        ) {
          errors.push(
            `param "${key}" has optionLabels that are not one string per option`,
          );
          continue;
        }
        spec.optionLabels = labels as string[];
      }
    }

    if (isNumericParam(type)) {
      const min = decl['min'];
      const max = decl['max'];
      if (typeof min === 'number' && Number.isFinite(min)) spec.min = min;
      if (typeof max === 'number' && Number.isFinite(max)) spec.max = max;
      if (
        spec.min !== undefined &&
        spec.max !== undefined &&
        spec.min > spec.max
      ) {
        errors.push(`param "${key}" has min ${spec.min} above max ${spec.max}`);
        continue;
      }
    }

    if (decl['default'] !== undefined) {
      const coerced = coerce(spec, decl['default']);
      if (coerced === undefined) {
        errors.push(
          `param "${key}" has a default of ${JSON.stringify(decl['default'])}, which is not a valid ${type}`,
        );
        continue;
      }
      spec.default = coerced;
    }

    specs.push(spec);
  }

  if (specs.length > SCRIPT_PARAM_LIMITS.maxKeys) {
    errors.push(
      `declares ${specs.length} params, over the limit of ${SCRIPT_PARAM_LIMITS.maxKeys}`,
    );
  }

  return { specs, errors };
}

/**
 * Reports stored values that do not fit a declaration, for the editor and the
 * content import to surface. Read-only: resolution at dispatch is what fixes
 * things up, this only explains what will change.
 */
export function checkStoredParams(
  specs: readonly ScriptParamSpec[],
  stored: Readonly<Record<string, unknown>> | undefined,
): string[] {
  const problems: string[] = [];
  const declared = new Map(specs.map((s) => [s.key, s]));

  for (const key of Object.keys(stored ?? {})) {
    if (!declared.has(key)) {
      problems.push(`param "${key}" is not declared by the behavior (ignored)`);
    }
  }

  for (const spec of specs) {
    const raw = stored?.[spec.key];
    if (raw === undefined || raw === null || raw === '') {
      if (spec.required && spec.default === undefined) {
        problems.push(`required param "${spec.key}" has no value`);
      }
      continue;
    }
    if (coerce(spec, raw) === undefined) {
      problems.push(
        `param "${spec.key}" has ${JSON.stringify(raw)}, which is not a valid ${spec.type}`,
      );
    }
  }

  return problems;
}

/**
 * Values a designer filled in for a behaviour's declared params, bounded:
 * this lands in a Mixed Mongoose field loaded on every content read. Keys
 * are checked against the declaration in contentValidation and undeclared
 * ones dropped at dispatch; this only keeps the blob small.
 */
export const ScriptParamsSchema = z
  .record(
    z.string().min(1).max(SCRIPT_PARAM_LIMITS.maxKeyLength),
    z.union([
      z.string().max(SCRIPT_PARAM_LIMITS.maxStringLength),
      z.number().finite(),
      z.boolean(),
    ]),
  )
  .refine(
    (params) => Object.keys(params).length <= SCRIPT_PARAM_LIMITS.maxKeys,
    `at most ${SCRIPT_PARAM_LIMITS.maxKeys} script params`,
  );
