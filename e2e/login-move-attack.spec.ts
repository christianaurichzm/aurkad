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
  await page
    .getByPlaceholder('Repeat the password', { exact: true })
    .fill(password);
  await page.getByRole('button', { name: 'Register' }).click();
  await expect(page.getByText(/account created/i)).toBeVisible();

  // Register hands over to Login on a timer with the name filled in.
  // `exact` keeps "Username" from also matching "Choose a username" while
  // both forms are mounted.
  await expect(page.getByPlaceholder('Username', { exact: true })).toHaveValue(
    username,
  );
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

  // Clear the form's focus through the HUD before sending movement keys.
  await page.locator('#hud-level').click();

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

test('creates a small map, teleports through the GM panel, and saves its tiles', async ({
  page,
}) => {
  test.skip(
    process.env.E2E_PRODUCTION !== 'true',
    'Requires the isolated admin fixture',
  );
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      /\[assets\]|\[gameLoop\]/.test(message.text())
    )
      errors.push(message.text());
  });
  const { self } = await registerAndLogin(
    page,
    'e2e-map-admin',
    'e2e-password',
  );
  await page.locator('#hud-level').click();
  await page.keyboard.press('c');
  const content = page.getByRole('dialog', { name: 'Content Editor' });
  await content.getByRole('button', { name: 'Maps', exact: true }).click();
  await content.getByPlaceholder('Map name', { exact: true }).fill('Small map');
  await content.locator('input[name="cols"]').fill('8');
  await content.locator('input[name="rows"]').fill('6');
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/maps') &&
      response.request().method() === 'POST',
  );
  await content.getByRole('button', { name: 'Create Map' }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { mapId } = (await response.json()) as { mapId: string };
  await content.getByRole('button', { name: 'Close', exact: true }).click();

  await page.locator('#hud-level').click();
  await page.keyboard.press('x');
  const gm = page.getByRole('dialog', { name: 'GM panel' });
  await gm
    .getByPlaceholder('Player name (type or pick below)')
    .fill('e2e-map-admin');
  await gm.getByLabel('Map ID', { exact: true }).fill('1');
  await gm.getByLabel('Col', { exact: true }).fill('19');
  await gm.getByLabel('Row', { exact: true }).fill('19');
  const onLargeMap = self.waitUntil(
    'the far corner of the large map',
    (s) => s.position.x === 19 * 64 && s.position.y === 19 * 64,
  );
  await gm.getByRole('button', { name: 'Warp', exact: true }).click();
  await onLargeMap;

  await gm.getByLabel('Map ID', { exact: true }).fill(mapId);
  const onSmallMap = self.waitUntil(
    'the clamped position on the small map',
    (s) => s.position.x === 7 * 64 && s.position.y === 5 * 64,
  );
  await gm.getByRole('button', { name: 'Warp', exact: true }).click();
  await onSmallMap;
  await gm.getByRole('button', { name: 'Close', exact: true }).click();
  // The cover is drawn on the fringe canvas, above the character and tiles.
  await expect
    .poll(() =>
      page
        .locator('#fringeCanvas')
        .evaluate(
          (canvas) =>
            (canvas as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(0, 0, 1, 1).data[3],
        ),
    )
    .toBe(0);

  await page.locator('#hud-level').click();
  await page.keyboard.press('z');
  await expect(page.locator('#mapName')).toHaveValue('Small map');
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  const saved = page.waitForResponse((response) =>
    response.url().endsWith('/saveMap'),
  );
  await page.locator('#saveButton').click();
  expect((await saved).ok()).toBe(true);
  const stored = await page.request.get(`/maps/${mapId}`);
  const map = (await stored.json()) as { tiles: { tileIndex: number }[][] };
  expect(map.tiles).toHaveLength(6);
  expect(
    map.tiles.every(
      (row) => row.length === 8 && row.every((tile) => tile.tileIndex === 0),
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('production uses a secure session through TLS and revokes a live socket', async ({
  page,
  context,
}) => {
  test.skip(
    process.env.E2E_PRODUCTION !== 'true',
    'Requires the production TLS fixture',
  );
  const password = 'e2e-password';
  const { ws } = await registerAndLogin(page, uniqueUsername(), password);
  expect(ws.url()).toMatch(/^wss:/);
  const cookie = (await context.cookies()).find((c) => c.name.endsWith('.sid'));
  expect(cookie).toMatchObject({
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
  });

  const reconnect = page.waitForEvent('websocket', (socket) =>
    socket.url().includes('/ws'),
  );
  await page.evaluate(() => {
    const socket = new window.WebSocket(`wss://${location.host}/ws`);
    (window as Window & { smokeSocket?: globalThis.WebSocket }).smokeSocket =
      socket;
  });
  const resumed = await reconnect;
  const self = trackSelf(resumed);
  await self.current('the resumed session');
  const closed = new Promise<void>((resolve) =>
    resumed.on('close', () => resolve()),
  );
  const changed = await page.request.post('/password', {
    data: { currentPassword: password, newPassword: 'changed-password' },
  });
  expect(changed.ok()).toBe(true);
  await closed;
  expect(resumed.isClosed()).toBe(true);
  const account = await page.request.get('/email');
  expect(account.status()).toBe(401);
});
