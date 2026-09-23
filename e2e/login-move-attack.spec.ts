import { test, expect, type WebSocket } from '@playwright/test';

// Golden path: register, log in, move, attack. Server tests cover the rules;
// this covers the seams only a browser has: the Vite proxy, the session
// cookie, the WebSocket handshake and the keyboard listener.
//
// The canvas has no per-tile DOM, so assertions read `self` from the
// server's worldUpdate, which proves the input changed the world.

function uniqueUsername(): string {
  return `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

async function registerAndLogin(
  page: import('@playwright/test').Page,
  username: string,
  password: string,
) {
  await page.goto('/');
  // Both the switch link and the Register submit read "Register", so this
  // one is scoped to the paragraph that invites switching.
  await page
    .getByText("Don't have an account?")
    .getByRole('button', { name: 'Register' })
    .click();

  await page
    .getByPlaceholder('Choose a username', { exact: true })
    .fill(username);
  await page
    .getByPlaceholder('Choose a password', { exact: true })
    .fill(password);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText(/account created/i)).toBeVisible();

  // Register hands over to Login on its own timer (pages/Register.tsx).
  // `exact` keeps "Username" from also matching "Choose a username" while
  // both forms are mounted.
  await page.getByPlaceholder('Username', { exact: true }).fill(username);
  await page.getByPlaceholder('Password', { exact: true }).fill(password);

  const wsPromise = page.waitForEvent('websocket', (ws) =>
    ws.url().includes('/ws'),
  );
  await page.getByRole('button', { name: 'Login' }).click();
  const ws = await wsPromise;
  // Before any other await: the event fires when the socket is created, so
  // no frame can be missed yet.
  const self = trackSelf(ws);

  // #hud-level renders once the game has both map and player, so login
  // succeeded and the world snapshot arrived.
  await expect(page.locator('#hud-level')).toBeVisible();
  return { ws, self };
}

/** The authoritative view of the logged-in player, as the server sends it. */
interface SelfState {
  position: { x: number; y: number };
  action: string;
  lastProcessedSeq?: number;
}

/**
 * Follows the `self` the server publishes from the moment the socket
 * exists. The server sends a worldUpdate only on change, so a late
 * listener on an idle map would wait forever.
 */
function trackSelf(ws: WebSocket) {
  let latest: SelfState | undefined;
  const waiters: Array<(self: SelfState) => void> = [];

  ws.on('framereceived', (frame) => {
    if (typeof frame.payload !== 'string') return;
    let msg: { type?: string; payload?: { self?: SelfState } };
    try {
      msg = JSON.parse(frame.payload) as typeof msg;
    } catch {
      return;
    }
    const self = msg.type === 'worldUpdate' ? msg.payload?.self : undefined;
    if (!self) return;
    latest = self;
    for (const notify of waiters.splice(0)) notify(self);
  });

  /**
   * The newest `self`, waiting for the first one if none has arrived yet.
   * Rejects by name rather than hanging, so a failure says what it wanted.
   */
  async function current(what = 'any position'): Promise<SelfState> {
    if (latest) return latest;
    return waitUntil(what, () => true);
  }

  /** Resolves once a `self` satisfies `predicate`, checked on arrival only. */
  function waitUntil(
    what: string,
    predicate: (self: SelfState) => boolean,
  ): Promise<SelfState> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`timed out waiting for the server to report ${what}`),
          ),
        10_000,
      );
      const notify = (self: SelfState) => {
        if (!predicate(self)) {
          waiters.push(notify);
          return;
        }
        clearTimeout(timer);
        resolve(self);
      };
      waiters.push(notify);
    });
  }

  return { current, waitUntil };
}

test('register, log in, move, and attack over the real stack', async ({
  page,
}) => {
  const username = uniqueUsername();
  const { ws, self } = await registerAndLogin(page, username, 'e2e-password');

  // The keyboard listener ignores keys while an <input> holds focus
  // (isInputActive in client/io/keyboard.ts), and a real player's first
  // click on the map is what makes movement work after typing a password,
  // so this clicks it too rather than waiting for the form to unmount.
  await page.locator('#gameMain').click();

  const start = await self.current('a starting position');

  // The server owns the position, so wait for it to report the player
  // elsewhere: input, queue and collision all passed.
  const movedPromise = self.waitUntil(
    'the player to move',
    (s) =>
      s.position.x !== start.position.x || s.position.y !== start.position.y,
  );
  await page.keyboard.down('ArrowDown');
  const moved = await movedPromise;
  await page.keyboard.up('ArrowDown');

  // Down specifically, since canvas y grows downward and any move would
  // change the position.
  expect(moved.position.y).toBeGreaterThan(start.position.y);

  // The server echoing Attack proves the attack happened, not just the
  // client thinking it did.
  const attackedPromise = self.waitUntil(
    'the attack to be applied',
    (s) => s.action === 'Attack',
  );
  await page.keyboard.down('Control');
  await attackedPromise;
  await page.keyboard.up('Control');

  // The connection survived all of it, which is the point of a smoke test.
  expect(ws.isClosed()).toBe(false);

  // A desktop keeps the card and the menu in a column beside the world, with
  // nothing to toggle; the sheet and its toggle are the touch test's.
  await expect(page.locator('#hud')).toBeVisible();
  await expect(page.locator('#sidePanel')).toBeVisible();
  await expect(page.locator('.panel-toggle')).toBeHidden();
});

test.describe('touch layout', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test('fits player panels and changes direction without lifting the thumb', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { ws } = await registerAndLogin(
      page,
      uniqueUsername(),
      'e2e-password',
    );
    await expect(page.getByRole('progressbar', { name: 'Mana' })).toBeVisible();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Settings' });
    await expect(settings).toBeVisible();
    expect(await settings.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    await settings.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Open game menu' }).click();
    await page.getByRole('button', { name: /inventory/i }).click();
    const inventory = page.getByRole('dialog', {
      name: 'Inventory',
      exact: true,
    });
    await expect(inventory).toBeVisible();
    expect(await inventory.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    await inventory.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: /Spells/ }).click();
    const spells = page.getByRole('dialog', { name: 'Spells', exact: true });
    await expect(spells).toBeVisible();
    expect(await spells.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    await spells.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Close game menu' }).click();

    const actions: Array<{ key: string; type: string }> = [];
    ws.on('framesent', (frame) => {
      if (typeof frame.payload !== 'string') return;
      const msg = JSON.parse(frame.payload) as {
        type: string;
        keyboardAction?: { key: string; type: string };
      };
      if (msg.type === 'keyboard' && msg.keyboardAction)
        actions.push(msg.keyboardAction);
    });
    const up = page.getByRole('button', { name: 'Move up', exact: true });
    const right = page.getByRole('button', { name: 'Move right', exact: true });
    const upBox = (await up.boundingBox())!;
    const rightBox = (await right.boundingBox())!;
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: upBox.x + upBox.width / 2, y: upBox.y + upBox.height / 2, id: 1 },
      ],
    });
    await expect(up).toHaveAttribute('aria-pressed', 'true');
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        {
          x: rightBox.x + rightBox.width / 2,
          y: rightBox.y + rightBox.height / 2,
          id: 1,
        },
      ],
    });
    await expect(right).toHaveAttribute('aria-pressed', 'true');
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await expect(right).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() => actions)
      .toEqual([
        { key: 'ArrowUp', type: 'press' },
        { key: 'ArrowUp', type: 'release' },
        { key: 'ArrowRight', type: 'press' },
        { key: 'ArrowRight', type: 'release' },
      ]);

    await page.setViewportSize({ width: 844, height: 390 });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    expect(await settings.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 844,
      height: 390,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(844);
    expect(errors).toEqual([]);
  });
});
