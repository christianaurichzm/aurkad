import { afterEach, expect, it } from 'vitest';
import { loadClientModule } from '../../../test/clientModule';

afterEach(() => document.body.replaceChildren());

const quest = (id: string, name: string, status: string) => ({
  id,
  name,
  status,
  progress: status === 'completed' ? 1 : 0,
  target: 1,
});

it('announces a quest taken and a quest finished, over the world', () => {
  const mod = loadClientModule('quest');
  const update = mod.handlers.get('quest:update')!;
  const orcs = quest('orcs', 'Orcs at the gate', 'active');

  // What the player already had when the game opened is not news.
  update([orcs]);
  expect(mod.container.textContent).toBe('');

  update([orcs, quest('crypt', 'Clear the Crypt', 'active')]);
  expect(mod.container.textContent).toContain('New quest: Clear the Crypt');

  update([orcs, quest('crypt', 'Clear the Crypt', 'completed')]);
  expect(mod.container.textContent).toContain(
    'Quest complete: Clear the Crypt',
  );
  expect(mod.engine.chat).toHaveBeenCalledWith(
    'Quest completed: Clear the Crypt',
  );
});
