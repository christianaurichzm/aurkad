/**
 * Exported params, editor side: an unreachable behaviour list must not
 * erase a saved wiring, and only declared keys are stored, typed.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScriptBehaviorDescriptor } from '../../../shared/scriptParams';
import { ScriptBehaviorFields } from './ScriptBehaviorFields';

const mocks = vi.hoisted(() => ({ fetchBehaviors: vi.fn() }));

vi.mock('../../io/network', () => ({
  fetchBehaviors: mocks.fetchBehaviors,
}));

const chest: ScriptBehaviorDescriptor = {
  id: 'chest',
  owner: 'chest.js',
  events: ['onEnter'],
  params: [
    { key: 'itemId', type: 'number', label: 'Reward', required: true },
    { key: 'quantity', type: 'number', default: 1 },
    { key: 'once', type: 'boolean', label: 'Only once' },
    { key: 'rarity', type: 'select', options: ['common', 'rare'] },
  ],
};

const sage: ScriptBehaviorDescriptor = {
  id: 'sage',
  owner: 'npcs.js',
  events: ['onInteract'],
  params: [],
};

const setup = (
  props: Partial<React.ComponentProps<typeof ScriptBehaviorFields>> = {},
) => {
  const onScriptIdChange = vi.fn();
  const onParamsChange = vi.fn();
  render(
    <ScriptBehaviorFields
      events={['onEnter']}
      scriptId=""
      onScriptIdChange={onScriptIdChange}
      params={{}}
      onParamsChange={onParamsChange}
      {...props}
    />,
  );
  return { onScriptIdChange, onParamsChange };
};

beforeEach(() => {
  mocks.fetchBehaviors.mockReset();
  mocks.fetchBehaviors.mockResolvedValue([chest, sage]);
});

describe('behavior list', () => {
  it('offers the behaviors that can run on this content', async () => {
    setup();

    expect(
      await screen.findByRole('option', { name: /^chest/ }),
    ).toBeInTheDocument();
  });

  // Offered but labelled, so an npc behaviour on the tile list does not look
  // like a typo and an existing wiring stays explainable.
  it('marks a behavior with no handler for this content', async () => {
    setup();

    expect(
      await screen.findByRole('option', { name: /sage - no handler/ }),
    ).toBeInTheDocument();
  });

  it('keeps a saved id nothing registers, rather than dropping it', async () => {
    setup({ scriptId: 'from-a-script-that-failed-to-load' });

    expect(
      await screen.findByRole('option', {
        name: /from-a-script-that-failed-to-load - not registered/,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue(
      'from-a-script-that-failed-to-load',
    );
  });

  it('says so when the list could not be loaded, keeping the value', async () => {
    mocks.fetchBehaviors.mockRejectedValue(new Error('offline'));
    setup({ scriptId: 'chest' });

    expect(await screen.findByText(/Could not load/)).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('chest');
  });

  it('warns when the selected behavior is not registered', async () => {
    setup({ scriptId: 'ghost' });

    expect(await screen.findByText(/nothing will run/)).toBeInTheDocument();
  });

  it('clears the params when the behavior changes', async () => {
    const user = userEvent.setup();
    const { onScriptIdChange, onParamsChange } = setup({
      scriptId: 'sage',
      params: { leftover: 1 },
      events: ['onEnter', 'onInteract'],
    });

    await screen.findByRole('option', { name: /^chest/ });
    await user.selectOptions(screen.getByRole('combobox'), 'chest');

    expect(onScriptIdChange).toHaveBeenCalledWith('chest');
    expect(onParamsChange).toHaveBeenCalledWith({});
  });
});

describe('param fields', () => {
  it('renders a field per declared param, labelled', async () => {
    setup({ scriptId: 'chest' });

    expect(await screen.findByText('Reward')).toBeInTheDocument();
    // No label declared, so the key is the label.
    expect(screen.getByText('quantity')).toBeInTheDocument();
    expect(screen.getByText('Only once')).toBeInTheDocument();
  });

  it('shows the declared default without storing it', async () => {
    const { onParamsChange } = setup({ scriptId: 'chest' });

    await waitFor(() =>
      expect(screen.getByDisplayValue('1')).toBeInTheDocument(),
    );
    // Writing the default in on open would make an untouched form look edited.
    expect(onParamsChange).not.toHaveBeenCalled();
  });

  it('stores a number as a number', async () => {
    const user = userEvent.setup();
    const { onParamsChange } = setup({ scriptId: 'chest' });

    const reward = await screen.findByDisplayValue('0');
    await user.type(reward, '7');

    expect(onParamsChange).toHaveBeenLastCalledWith({ itemId: 7 });
  });

  it('stores a checkbox as a boolean', async () => {
    const user = userEvent.setup();
    const { onParamsChange } = setup({ scriptId: 'chest' });

    await user.click(await screen.findByRole('checkbox'));

    expect(onParamsChange).toHaveBeenLastCalledWith({ once: true });
  });

  it('drops a value cleared back to empty, so the default applies again', async () => {
    const user = userEvent.setup();
    const { onParamsChange } = setup({
      scriptId: 'chest',
      params: { quantity: 5 },
    });

    await user.clear(await screen.findByDisplayValue('5'));

    expect(onParamsChange).toHaveBeenLastCalledWith({});
  });

  it('offers only the declared options for a select param', async () => {
    setup({ scriptId: 'chest' });

    await screen.findByText('rarity');
    const selects = screen.getAllByRole('combobox');
    const rarity = selects[selects.length - 1]!;
    expect([...rarity.querySelectorAll('option')].map((o) => o.value)).toEqual([
      'common',
      'rare',
    ]);
  });

  it('says a behavior has no settings rather than showing nothing', async () => {
    setup({ scriptId: 'sage', events: ['onInteract'] });

    expect(await screen.findByText(/no settings/)).toBeInTheDocument();
  });
});
