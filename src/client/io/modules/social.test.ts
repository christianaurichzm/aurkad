import { describe, it, expect, beforeEach } from 'vitest';
import { loadClientModule } from '../../../test/clientModule';

// The shipped modules/social/client.js, loaded the way the browser loads it.

let mod: ReturnType<typeof loadClientModule>;

beforeEach(() => {
  mod = loadClientModule('social');
});

const panel = () => mod.panels[0];
const update = (payload: unknown) =>
  mod.handlers.get('social:update')!(payload);
const rows = () => [...panel().body.querySelectorAll('span')];
const names = () => rows().map((s) => s.textContent);
const sent = () =>
  (
    mod.engine.sendServerEvent as unknown as {
      mock: { calls: [string, unknown][] };
    }
  ).mock.calls;
const clickButton = (label: string) => {
  const button = [...panel().body.querySelectorAll('button')].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`no "${label}" button in the panel`);
  button.click();
};

const LISTS = {
  friends: [
    { name: 'Bo', online: true },
    { name: 'Cy', online: false },
  ],
  ignored: ['Troll'],
  maxFriends: 100,
  maxIgnored: 100,
};

describe('on load', () => {
  it('asks the server for the lists', () => {
    expect(sent()).toContainEqual(['social:request']);
  });

  it('puts the two things a click on a player is for in the menu', () => {
    const registered = (
      mod.engine.registerPlayerAction as {
        mock: { calls: [string, (name: string) => void][] };
      }
    ).mock.calls;

    registered.find((c) => c[0] === 'Add friend')![1]('Bo');
    registered.find((c) => c[0] === 'Ignore')![1]('Troll');

    expect(sent()).toContainEqual(['social:friendAdd', { name: 'Bo' }]);
    expect(sent()).toContainEqual(['social:ignoreAdd', { name: 'Troll' }]);
  });

  it('draws an empty state rather than a blank panel', () => {
    expect(panel().body.textContent).toContain('No friends yet.');
  });
});

describe('the friends tab', () => {
  it('lists each friend with whether they are online', () => {
    update(LISTS);

    expect(names()).toContain('Bo');
    expect(names()).toContain('online');
    expect(names()).toContain('offline');
  });

  it('counts the online ones in the title', () => {
    update(LISTS);

    expect(panel().title).toBe('Friends (1/2 online)');
  });

  it('removes the friend whose row was clicked', () => {
    update(LISTS);

    clickButton('Remove');

    expect(sent()).toContainEqual(['social:friendRemove', { name: 'Bo' }]);
  });

  it('adds the typed name and clears the field', () => {
    update(LISTS);
    const input = panel().body.querySelector('input')!;
    input.value = '  Dee  ';

    clickButton('Add');

    expect(sent()).toContainEqual(['social:friendAdd', { name: 'Dee' }]);
    expect(input.value).toBe('');
  });

  it('sends nothing for an empty field', () => {
    update(LISTS);
    const before = sent().length;

    clickButton('Add');

    expect(sent()).toHaveLength(before);
  });
});

describe('the ignored tab', () => {
  beforeEach(() => {
    update(LISTS);
    clickButton('Ignored');
  });

  it('switches to the other list', () => {
    expect(names()).toContain('Troll');
    expect(names()).not.toContain('Bo');
  });

  it('sends the add on the ignore channel, not the friend one', () => {
    panel().body.querySelector('input')!.value = 'Spammer';

    clickButton('Add');

    expect(sent()).toContainEqual(['social:ignoreAdd', { name: 'Spammer' }]);
  });

  it('removes from the ignore list', () => {
    clickButton('Remove');

    expect(sent()).toContainEqual(['social:ignoreRemove', { name: 'Troll' }]);
  });
});

describe('a payload that is not there', () => {
  it('is ignored rather than drawn from', () => {
    update(LISTS);
    expect(() => update(null)).not.toThrow();
    expect(names()).toContain('Bo'); // the last good state is kept
  });
});
