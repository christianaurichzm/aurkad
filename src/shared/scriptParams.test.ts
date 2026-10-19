/**
 * Exported behaviour params. The editor renders a form from a declaration
 * and the runtime resolves stored values against it, so these pin the
 * coercion both share: what the form accepts means the same at dispatch.
 */
import { describe, it, expect } from 'vitest';
import {
  checkStoredParams,
  defaultParamValue,
  normalizeParamSpecs,
  resolveScriptParams,
  SCRIPT_PARAM_LIMITS,
  ScriptParamsSchema,
  type ScriptParamSpec,
} from './scriptParams.js';

const spec = (over: Partial<ScriptParamSpec> = {}): ScriptParamSpec => ({
  key: 'itemId',
  type: 'number',
  ...over,
});

describe('normalizeParamSpecs', () => {
  it('keeps declaration order, which is the order fields render in', () => {
    const { specs, errors } = normalizeParamSpecs({
      message: { type: 'text' },
      itemId: { type: 'item' },
      once: { type: 'boolean' },
    });
    expect(errors).toEqual([]);
    expect(specs.map((s) => s.key)).toEqual(['message', 'itemId', 'once']);
  });

  it('accepts an absent declaration', () => {
    expect(normalizeParamSpecs(undefined)).toEqual({ specs: [], errors: [] });
  });

  it('rejects an unknown type instead of rendering nothing', () => {
    const { errors } = normalizeParamSpecs({ x: { type: 'colour' } });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('unknown type');
  });

  it('rejects a select with no options', () => {
    expect(normalizeParamSpecs({ x: { type: 'select' } }).errors).toHaveLength(
      1,
    );
    expect(
      normalizeParamSpecs({ x: { type: 'select', options: [] } }).errors,
    ).toHaveLength(1);
    expect(
      normalizeParamSpecs({ x: { type: 'select', options: ['a', 2] } }).errors,
    ).toHaveLength(1);
  });

  it('takes a label per select option, and only one per option', () => {
    const labelled = normalizeParamSpecs({
      spell: {
        type: 'select',
        options: ['1', '2'],
        optionLabels: ['Frost', 'Heal'],
      },
    });
    expect(labelled.errors).toEqual([]);
    expect(labelled.specs[0]!.optionLabels).toEqual(['Frost', 'Heal']);

    expect(
      normalizeParamSpecs({
        spell: { type: 'select', options: ['1', '2'], optionLabels: ['Frost'] },
      }).errors,
    ).toHaveLength(1);
  });

  it('rejects a default the type cannot hold', () => {
    const { errors } = normalizeParamSpecs({
      x: { type: 'number', default: 'lots' },
    });
    expect(errors[0]).toContain('not a valid number');
  });

  it('rejects a default outside the select options', () => {
    const { errors } = normalizeParamSpecs({
      x: { type: 'select', options: ['a', 'b'], default: 'c' },
    });
    expect(errors[0]).toContain('not a valid select');
  });

  it('coerces a usable default rather than storing it raw', () => {
    const { specs, errors } = normalizeParamSpecs({
      x: { type: 'number', default: '3' },
    });
    expect(errors).toEqual([]);
    expect(specs[0]?.default).toBe(3);
  });

  it('rejects an inverted range', () => {
    const { errors } = normalizeParamSpecs({
      x: { type: 'number', min: 10, max: 1 },
    });
    expect(errors[0]).toContain('above max');
  });

  it('rejects a params value that is not an object', () => {
    expect(normalizeParamSpecs([{ type: 'text' }]).errors).toHaveLength(1);
    expect(normalizeParamSpecs('itemId').errors).toHaveLength(1);
    expect(normalizeParamSpecs({ x: 'text' }).errors).toHaveLength(1);
  });
});

describe('resolveScriptParams', () => {
  it('drops keys the behaviour does not declare', () => {
    const { params } = resolveScriptParams([spec()], {
      itemId: 4,
      leftover: 'from a renamed param',
    });
    expect(params).toEqual({ itemId: 4 });
  });

  it('coerces to the declared type', () => {
    const { params } = resolveScriptParams(
      [
        spec({ key: 'n', type: 'number' }),
        spec({ key: 't', type: 'text' }),
        spec({ key: 'b', type: 'boolean' }),
      ],
      { n: '7', t: 12, b: 'true' },
    );
    expect(params).toEqual({ n: 7, t: '12', b: true });
  });

  it('reads "false" as false', () => {
    // A checkbox that round-tripped through a form or an older document
    // arrives as a string, where truthiness would invert it.
    const { params } = resolveScriptParams(
      [spec({ key: 'b', type: 'boolean' })],
      {
        b: 'false',
      },
    );
    expect(params).toEqual({ b: false });
  });

  it('clamps a number to the declared range', () => {
    const specs = [spec({ key: 'n', min: 1, max: 10 })];
    expect(resolveScriptParams(specs, { n: 0 }).params).toEqual({ n: 1 });
    expect(resolveScriptParams(specs, { n: 99 }).params).toEqual({ n: 10 });
  });

  it('falls back to the default when the stored value is unusable', () => {
    const { params } = resolveScriptParams([spec({ key: 'n', default: 5 })], {
      n: 'not a number',
    });
    expect(params).toEqual({ n: 5 });
  });

  it('leaves an unusable value with no default undefined, not zero', () => {
    // 0 would read as "item 0" and be handed to giveItem as a real id.
    const { params } = resolveScriptParams([spec({ type: 'item' })], {
      itemId: 'potion',
    });
    expect('itemId' in params).toBe(false);
  });

  it('reports declared-required params content left empty', () => {
    const { missing } = resolveScriptParams(
      [spec({ required: true }), spec({ key: 'other', type: 'text' })],
      {},
    );
    expect(missing).toEqual(['itemId']);
  });

  it('does not report a required param that has a default', () => {
    const { params, missing } = resolveScriptParams(
      [spec({ required: true, default: 2 })],
      undefined,
    );
    expect(missing).toEqual([]);
    expect(params).toEqual({ itemId: 2 });
  });

  it('rejects a select value outside the options', () => {
    const specs = [
      spec({ key: 'rarity', type: 'select', options: ['common', 'rare'] }),
    ];
    expect(resolveScriptParams(specs, { rarity: 'rare' }).params).toEqual({
      rarity: 'rare',
    });
    expect(resolveScriptParams(specs, { rarity: 'legendary' }).params).toEqual(
      {},
    );
  });

  it('refuses an object where a scalar is declared', () => {
    const { params } = resolveScriptParams([spec({ key: 't', type: 'text' })], {
      t: { nested: true },
    });
    expect(params).toEqual({});
  });
});

describe('defaultParamValue', () => {
  it('starts a field at the declared default', () => {
    expect(defaultParamValue(spec({ default: 3 }))).toBe(3);
  });

  it('starts a field at the type empty value otherwise', () => {
    expect(defaultParamValue(spec({ type: 'text' }))).toBe('');
    expect(defaultParamValue(spec({ type: 'boolean' }))).toBe(false);
    expect(defaultParamValue(spec({ type: 'number' }))).toBe(0);
    expect(
      defaultParamValue(spec({ type: 'select', options: ['a', 'b'] })),
    ).toBe('a');
  });
});

describe('checkStoredParams', () => {
  it('is quiet when the values fit', () => {
    expect(checkStoredParams([spec()], { itemId: 3 })).toEqual([]);
  });

  it('reports a stored key nothing declares', () => {
    const problems = checkStoredParams([spec()], { itemId: 3, qty: 2 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('"qty"');
  });

  it('reports a required param with no value and no default', () => {
    expect(checkStoredParams([spec({ required: true })], {})).toHaveLength(1);
    expect(
      checkStoredParams([spec({ required: true, default: 1 })], {}),
    ).toEqual([]);
  });

  it('reports a value the declared type cannot hold', () => {
    const problems = checkStoredParams([spec()], { itemId: 'potion' });
    expect(problems[0]).toContain('not a valid number');
  });
});

// The write boundary for behaviour params. A script's declaration is not a
// licence to write anything into a content document: these land in a Mixed
// Mongoose field that is loaded on every content read.
describe('ScriptParamsSchema', () => {
  it('accepts the scalars a form field can hold', () => {
    const params = { itemId: 3, message: 'hi', once: true };
    const result = ScriptParamsSchema.safeParse(params);
    expect(result.success && result.data).toEqual(params);
  });

  it('rejects a nested object, which no param type can hold', () => {
    expect(
      ScriptParamsSchema.safeParse({ reward: { itemId: 3 } }).success,
    ).toBe(false);
  });

  it('rejects a string over the length cap', () => {
    const message = 'x'.repeat(SCRIPT_PARAM_LIMITS.maxStringLength + 1);
    expect(ScriptParamsSchema.safeParse({ message }).success).toBe(false);
  });

  it('rejects more keys than any declaration can have', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: SCRIPT_PARAM_LIMITS.maxKeys + 1 }, (_, i) => [
        `k${i}`,
        1,
      ]),
    );
    expect(ScriptParamsSchema.safeParse(tooMany).success).toBe(false);
  });
});
