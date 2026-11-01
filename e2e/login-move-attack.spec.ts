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
  return login(page, username, password);
}

/**
 * What the page itself reports as broken. The engine catches what a module or
 * the render loop throws, so those arrive as console errors, not page errors.
 */
function watchErrors(page: import('@playwright/test').Page): string[] {
  const errors: string[] = [];
  // The dev run plays the repository root, which has no art to load.
  const reported =
    process.env.E2E_PRODUCTION === 'true'
      ? /\[assets\]|\[gameLoop\]|\[modules?[\]:]/
      : /\[gameLoop\]|\[modules?[\]:]/;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && reported.test(message.text()))
      errors.push(message.text());
  });
  return errors;
}

/** Signs in from the login form, and follows the socket the game opens. */
async function login(
  page: import('@playwright/test').Page,
  username: string,
  password: string,
) {
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

/** Another player, as the worldUpdate diffs have built it up so far. */
interface OtherPlayer {
  name: string;
  position: { x: number; y: number };
  action: string;
}

/**
 * Follows the `self` the server publishes from the moment the socket
 * exists. The server sends a worldUpdate only on change, so a late
 * listener on an idle map would wait forever.
 */
function trackSelf(ws: WebSocket) {
  let latest: SelfState | undefined;
  const others = new Map<string, Partial<OtherPlayer>>();
  const waiters: Array<(self: SelfState) => void> = [];

  ws.on('framereceived', (frame) => {
    if (typeof frame.payload !== 'string') return;
    let msg: {
      type?: string;
      payload?: {
        self?: SelfState;
        entities?: Record<string, Partial<OtherPlayer>>;
        leave?: string[];
      };
    };
    try {
      msg = JSON.parse(frame.payload) as typeof msg;
    } catch {
      return;
    }
    const update = msg.type === 'worldUpdate' ? msg.payload : undefined;
    for (const id of update?.leave ?? []) others.delete(id);
    for (const [id, entity] of Object.entries(update?.entities ?? {}))
      others.set(id, { ...others.get(id), ...entity });
    const self = update?.self;
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

  /** What the server last said about a player in view, if one is. */
  const other = (name: string) =>
    [...others.values()].find((entity) => entity.name === name);

  return { current, waitUntil, other };
}

/**
 * Whether the client's own world holds a player. Vite serves each source file
 * at its path, so this import is the module the running game uses. A build has
 * only hashed chunks, and the socket is all a test can read there.
 */
async function expectInClient(
  page: import('@playwright/test').Page,
  name: string,
  present: boolean,
) {
  if (process.env.E2E_PRODUCTION === 'true') return;
  await expect
    .poll(() =>
      page.evaluate(async (wanted) => {
        const url = '/src/client/core/gameState.ts';
        const { getGameState } = (await import(url)) as {
          getGameState: () => { players: Record<string, { name: string }> };
        };
        return Object.values(getGameState().players).some(
          (player) => player.name === wanted,
        );
      }, name),
    )
    .toBe(present);
}

/** Holds `key` until the server reports the player elsewhere. */
async function walk(
  page: import('@playwright/test').Page,
  self: ReturnType<typeof trackSelf>,
  key: string,
) {
  const start = await self.current('a starting position');
  const moved = self.waitUntil(
    'the player to move',
    (s) =>
      s.position.x !== start.position.x || s.position.y !== start.position.y,
  );
  await page.keyboard.down(key);
  const end = await moved;
  await page.keyboard.up(key);
  return { start, end };
}

test('register, log in, move, and attack over the real stack', async ({
  page,
}) => {
  const errors = watchErrors(page);
  const username = uniqueUsername();
  const { ws, self } = await registerAndLogin(page, username, 'e2e-password');

  // Clear the form's focus through the HUD before sending movement keys.
  await page.locator('#hud-level').click();

  // The server owns the position, so wait for it to report the player
  // elsewhere: input, queue and collision all passed.
  const { start, end } = await walk(page, self, 'ArrowDown');

  // Down specifically, since canvas y grows downward and any move would
  // change the position.
  expect(end.position.y).toBeGreaterThan(start.position.y);

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
  expect(errors).toEqual([]);
});

test('two players see each other move, attack, chat, and leave', async ({
  page,
  browser,
}) => {
  const first = uniqueUsername();
  const second = uniqueUsername();
  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  const errors = watchErrors(page);
  const secondErrors = watchErrors(secondPage);
  const a = await registerAndLogin(page, first, 'e2e-password');
  const b = await registerAndLogin(secondPage, second, 'e2e-password');

  // One arrived in view of the other, and one was already there on arrival.
  await expect.poll(() => a.self.other(second)?.name).toBe(second);
  await expect.poll(() => b.self.other(first)?.name).toBe(first);
  await expectInClient(page, second, true);
  await expectInClient(secondPage, first, true);

  await secondPage.locator('#hud-level').click();
  const { start } = await walk(secondPage, b.self, 'ArrowDown');
  await expect
    .poll(async () => {
      const { x, y } = (await b.self.current()).position;
      const seen = a.self.other(second)?.position;
      return seen?.x === x && seen.y === y && y > start.position.y;
    })
    .toBe(true);

  await secondPage.keyboard.down('Control');
  await expect.poll(() => a.self.other(second)?.action).toBe('Attack');
  await secondPage.keyboard.up('Control');

  const line = `hello from ${first}`;
  await page.locator('#chatInput').fill(line);
  await page.locator('#chatInput').press('Enter');
  await expect(secondPage.locator('#chatBox')).toContainText(line);

  await secondContext.close();
  await expect.poll(() => a.self.other(second)).toBeUndefined();
  await expectInClient(page, second, false);
  expect([...errors, ...secondErrors]).toEqual([]);
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
    const errors = watchErrors(page);
    const { ws } = await registerAndLogin(
      page,
      uniqueUsername(),
      'e2e-password',
    );
    await expect(page.getByRole('progressbar', { name: 'HP' })).toBeVisible();
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
    // A module's window, from quest: on in the default game and in a new one.
    await page.getByRole('button', { name: /Quests/ }).click();
    const quests = page.getByRole('dialog', { name: 'Quests', exact: true });
    await expect(quests).toBeVisible();
    expect(await quests.boundingBox()).toEqual({
      x: 0,
      y: 0,
      width: 390,
      height: 844,
    });
    await quests.getByRole('button', { name: 'Close', exact: true }).click();
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

test('creates, edits, crosses, resizes, and reconnects on small maps', async ({
  page,
}) => {
  test.skip(
    process.env.E2E_PRODUCTION !== 'true',
    'Requires the isolated admin fixture',
  );
  test.setTimeout(60_000);
  const errors = watchErrors(page);
  // The fixture makes this one name the admin, so a retry against the same
  // server finds the account the attempt before it registered: 409 is fine.
  const registered = await page.request.post('/register', {
    data: { username: 'e2e-map-admin', password: 'e2e-password' },
  });
  expect([201, 409]).toContain(registered.status());
  await page.goto('/');
  const { self } = await login(page, 'e2e-map-admin', 'e2e-password');
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
  await expect(gm.getByLabel('Col', { exact: true })).toHaveAttribute(
    'min',
    '0',
  );
  await expect(gm.getByLabel('Row', { exact: true })).toHaveAttribute(
    'min',
    '0',
  );
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
  // The cover is drawn on the text canvas too, the top layer, and there no
  // module tints this corner as lighting and daynight do on the fringe canvas.
  await expect
    .poll(() =>
      page
        .locator('#textCanvas')
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

  // Keep the painter open across the transition: its buffer must follow the
  // new map before a save can overwrite any tiles.
  const backOnLargeMap = self.waitUntil(
    'the large map with the painter open',
    (s) => s.position.x === 3 * 64 && s.position.y === 3 * 64,
  );
  expect(
    (
      await page.request.post('/mod/warp', {
        data: { playerName: 'e2e-map-admin', mapId: '1', col: 3, row: 3 },
      })
    ).ok(),
  ).toBe(true);
  await backOnLargeMap;
  await expect(page.locator('#mapName')).toHaveValue('Smoke');
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  const savedLargeMap = page.waitForResponse((response) =>
    response.url().endsWith('/saveMap'),
  );
  await page.locator('#saveButton').click();
  const largeSave = await savedLargeMap;
  expect(largeSave.ok()).toBe(true);
  const body = largeSave.request().postDataJSON() as {
    mapId: string;
    tiles: unknown[][];
  };
  expect(body.mapId).toBe('1');
  expect(body.tiles).toHaveLength(20);
  expect(body.tiles.every((row) => row.length === 20)).toBe(true);
  const unchangedSmallMap = (await (
    await page.request.get(`/maps/${mapId}`)
  ).json()) as typeof map;
  expect(unchangedSmallMap.tiles).toEqual(map.tiles);

  const backOnSmallMap = self.waitUntil(
    'the small map before resizing',
    (s) => s.position.x === 7 * 64 && s.position.y === 5 * 64,
  );
  expect(
    (
      await page.request.post('/mod/warp', {
        data: { playerName: 'e2e-map-admin', mapId, col: 19, row: 19 },
      })
    ).ok(),
  ).toBe(true);
  await backOnSmallMap;
  await expect(page.locator('#mapName')).toHaveValue('Small map');
  await page
    .locator('#tilesetContainer')
    .getByRole('button', { name: 'Close', exact: true })
    .click();

  const afterResize = self.waitUntil(
    'the live player inside the resized map',
    (s) => s.position.x === 3 * 64 && s.position.y === 2 * 64,
  );
  expect(
    (
      await page.request.post(`/maps/${mapId}/resize`, {
        data: { cols: 4, rows: 3 },
      })
    ).ok(),
  ).toBe(true);
  await afterResize;

  const newSelf = page
    .waitForEvent('websocket', (socket) => socket.url().includes('/ws'))
    .then(trackSelf);
  await page.reload();
  await page
    .getByPlaceholder('Username', { exact: true })
    .fill('e2e-map-admin');
  await page.getByPlaceholder('Password', { exact: true }).fill('e2e-password');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  const resumed = await newSelf;
  await expect(page.locator('#hud-level')).toBeVisible();
  expect(
    (await resumed.current('the saved position after reconnect')).position,
  ).toEqual({ x: 3 * 64, y: 2 * 64 });
  await expect
    .poll(() =>
      page
        .locator('#textCanvas')
        .evaluate(
          (canvas) =>
            (canvas as HTMLCanvasElement)
              .getContext('2d')!
              .getImageData(0, 0, 1, 1).data[3],
        ),
    )
    .toBe(0);

  expect(
    (
      await page.request.post('/mod/warp', {
        data: { playerName: 'e2e-map-admin', mapId, col: -1, row: 0 },
      })
    ).status(),
  ).toBe(400);
  await page.locator('#hud-level').click();
  await page.keyboard.press('z');
  await expect(page.locator('#mapName')).toHaveValue('Small map');
  await page.getByRole('button', { name: 'Fill', exact: true }).click();
  const savedAfterReconnect = page.waitForResponse((response) =>
    response.url().endsWith('/saveMap'),
  );
  await page.locator('#saveButton').click();
  expect((await savedAfterReconnect).ok()).toBe(true);
  const resizedMap = (await (
    await page.request.get(`/maps/${mapId}`)
  ).json()) as { tiles: unknown[][] };
  expect(resizedMap.tiles).toHaveLength(3);
  expect(resizedMap.tiles.every((row) => row.length === 4)).toBe(true);
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

test('the built client credits the engine and carries its NOTICE', async ({
  page,
}) => {
  test.skip(
    process.env.E2E_PRODUCTION !== 'true',
    'Only a build writes NOTICE into the bundle',
  );
  await page.goto('/');
  await expect(
    page.getByRole('link', { name: /Powered by Aurkad/ }),
  ).toHaveAttribute('href', 'https://github.com/christianaurichzm/aurkad');

  const entry = await page
    .locator('script[type="module"][src^="/assets/"]')
    .getAttribute('src');
  const bundle = await page.request.get(entry!);
  expect(await bundle.text()).toContain(
    'software developed by Christian Aurich Zanettini Martins',
  );
});

test('every client module loads in the built game', async ({ page }) => {
  test.skip(
    process.env.E2E_PRODUCTION !== 'true',
    'Only the production fixture turns them all on',
  );
  const errors = watchErrors(page);
  const loaded: string[] = [];
  page.on('console', (message) => {
    const id = /\[modules\] client loaded: (\S+)/.exec(message.text())?.[1];
    if (id) loaded.push(id);
  });
  await registerAndLogin(page, uniqueUsername(), 'e2e-password');
  const modules = (await (await page.request.get('/modules')).json()) as {
    id: string;
  }[];
  expect(modules.length).toBeGreaterThanOrEqual(20);
  await expect
    .poll(() => loaded.toSorted())
    .toEqual(modules.map((module) => module.id).toSorted());
  // A module's own drawing runs with the frame, after it has loaded.
  await page.evaluate(() => new Promise(requestAnimationFrame));
  expect(errors).toEqual([]);
});

test.describe('Gravewatch', () => {
  test.use({ baseURL: 'https://localhost:8444' });

  test('shows a newcomer how to play and walks the isometric map', async ({
    page,
  }) => {
    test.skip(
      process.env.E2E_PRODUCTION !== 'true',
      'Only the production fixture serves the demo',
    );
    const errors = watchErrors(page);
    const { self } = await registerAndLogin(
      page,
      uniqueUsername(),
      'e2e-password',
    );
    const help = page.getByRole('dialog', { name: 'How to play' });
    await expect(help).toBeVisible();
    await help.getByRole('button', { name: 'Close', exact: true }).click();

    await page.locator('#hud-level').click();
    await walk(page, self, 'ArrowUp');
    expect(errors).toEqual([]);
  });
});
