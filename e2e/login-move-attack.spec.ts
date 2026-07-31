import { test, expect, type WebSocket } from '@playwright/test';

// Golden path: register, log in, move, attack. What sits behind these
// steps (collision, damage, the wire format) is covered server-side; only a
// real browser catches the seams: the Vite proxy, the session cookie, the
// WebSocket handshake and the DOM the keyboard listener binds to.
//
// The client draws to a canvas with no per-tile DOM, so a move is asserted
// from the wire (the keyboard action the client sends, see sendAction in
// wsManager.ts) rather than from pixels.

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

/** Resolves with the first sent frame matching `predicate`, or times out. */
function waitForSentKeyboardFrame(
  ws: WebSocket,
  predicate: (msg: {
    keyboardAction?: { key: string; type: string };
  }) => boolean,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('timed out waiting for a matching WS frame')),
      5_000,
    );
    ws.on('framesent', (frame) => {
      if (typeof frame.payload !== 'string') return;
      let msg: unknown;
      try {
        msg = JSON.parse(frame.payload);
      } catch {
        return;
      }
      if (
        typeof msg === 'object' &&
        msg !== null &&
        (msg as { type?: string }).type === 'keyboard' &&
        predicate(msg as { keyboardAction?: { key: string; type: string } })
      ) {
        clearTimeout(timer);
        resolve();
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

  // Move: press and release a direction key. The client only sends a fresh
  // 'press' while the key isn't already held (keyboard.ts), so this proves
  // the DOM key event reached handleInput and was not swallowed by e.g. a
  // form field still holding focus after login.
  const movePressed = waitForSentKeyboardFrame(
    ws,
    (m) =>
      m.keyboardAction?.key === 'ArrowDown' &&
      m.keyboardAction.type === 'press',
  );
  await page.keyboard.down('ArrowDown');
  await movePressed;

  const moveReleased = waitForSentKeyboardFrame(
    ws,
    (m) =>
      m.keyboardAction?.key === 'ArrowDown' &&
      m.keyboardAction.type === 'release',
  );
  await page.keyboard.up('ArrowDown');
  await moveReleased;

  // Attack: Control is handled specially in keyboard.ts; a press sends the
  // wire action and starts the client-side cooldown indicator at once,
  // before any round trip, so the HUD is a second, independent signal that
  // the keypress took effect.
  const attackPressed = waitForSentKeyboardFrame(
    ws,
    (m) =>
      m.keyboardAction?.key === 'Control' && m.keyboardAction.type === 'press',
  );
  await page.keyboard.down('Control');
  await attackPressed;
  await expect(page.locator('#atk-cooldown-container')).toBeVisible();
  await page.keyboard.up('Control');

  // The connection survived all of it, which is the point of a smoke test.
  expect(ws.isClosed()).toBe(false);
});
