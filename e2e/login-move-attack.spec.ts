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

  // #hud-level renders once the game has both map and player, so login
  // succeeded and the world snapshot arrived.
  await expect(page.locator('#hud-level')).toBeVisible();
  return ws;
}

/** The authoritative view of the logged-in player, as the server sends it. */
interface SelfState {
  position: { x: number; y: number };
  action: string;
  lastProcessedSeq?: number;
}

/**
 * Resolves with the first `self` the server sends that satisfies `predicate`.
 *
 * Rejects rather than hanging so a failure names what it was waiting for
 * instead of surfacing as a bare test timeout.
 */
function waitForSelf(
  ws: WebSocket,
  what: string,
  predicate: (self: SelfState) => boolean,
): Promise<SelfState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(new Error(`timed out waiting for the server to report ${what}`)),
      10_000,
    );
    ws.on('framereceived', (frame) => {
      if (typeof frame.payload !== 'string') return;
      let msg: { type?: string; payload?: { self?: SelfState } };
      try {
        msg = JSON.parse(frame.payload) as typeof msg;
      } catch {
        return;
      }
      const self = msg.type === 'worldUpdate' ? msg.payload?.self : undefined;
      if (self && predicate(self)) {
        clearTimeout(timer);
        resolve(self);
      }
    });
  });
}

test('register, log in, move, and attack over the real stack', async ({
  page,
}) => {
  const username = uniqueUsername();
  const ws = await registerAndLogin(page, username, 'e2e-password');

  // The keyboard listener ignores keys while an <input> holds focus
  // (isInputActive in client/io/keyboard.ts), and a real player's first
  // click on the map is what makes movement work after typing a password,
  // so this clicks it too rather than waiting for the form to unmount.
  await page.locator('#gameMain').click();

  const start = await waitForSelf(ws, 'a starting position', () => true);

  // The server owns the position, so wait for it to report the player
  // elsewhere: input, queue and collision all passed.
  const movedPromise = waitForSelf(
    ws,
    'the player to move',
    (self) =>
      self.position.x !== start.position.x ||
      self.position.y !== start.position.y,
  );
  await page.keyboard.down('ArrowDown');
  const moved = await movedPromise;
  await page.keyboard.up('ArrowDown');

  // Down specifically, since canvas y grows downward and any move would
  // change the position.
  expect(moved.position.y).toBeGreaterThan(start.position.y);

  // Attack. Same idea: the HUD cooldown below is client-side and fires
  // without waiting for anyone, so the server echoing Attack is what
  // separates "the client thinks it attacked" from "it attacked".
  const attackedPromise = waitForSelf(
    ws,
    'the attack to be applied',
    (self) => self.action === 'Attack',
  );
  await page.keyboard.down('Control');
  await attackedPromise;
  await expect(page.locator('#atk-cooldown-container')).toBeVisible();
  await page.keyboard.up('Control');

  // The connection survived all of it, which is the point of a smoke test.
  expect(ws.isClosed()).toBe(false);
});
