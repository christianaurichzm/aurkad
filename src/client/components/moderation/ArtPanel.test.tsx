import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ArtPanel } from './ArtPanel';

// The real client over a fetch that answers like the server, so the
// assertions check what goes on the wire.

let sent: { path: string; type: string; body: unknown }[];
let answer: Response;

beforeEach(() => {
  sent = [];
  answer = new Response(null, { status: 204 });
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      sent.push({ path, type: headers['Content-Type'] ?? '', body: init.body });
      return Promise.resolve(answer);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const sheet = (bytes = 4) =>
  new File([new Uint8Array(bytes)], 'sheet.png', { type: 'image/png' });

it('sends a character sheet with the layout it was drawn in', async () => {
  render(<ArtPanel />);

  await userEvent.selectOptions(
    screen.getByRole('combobox'),
    '3 frames per direction, 48 px (the RPG Maker MV/MZ format)',
  );
  const file = sheet();
  await userEvent.upload(screen.getByLabelText('Replace Characters'), file);

  expect(sent).toEqual([
    {
      path: '/admin/assets/sprites?layout=three-48',
      type: 'image/png',
      body: file,
    },
  ]);
  expect(await screen.findByRole('status')).toHaveTextContent('Sent.');
});

it('sends any other sheet as it is, and says why the server refused one', async () => {
  answer = new Response(
    JSON.stringify({ error: 'items.png is cut in 64 px squares' }),
    { status: 422, headers: { 'Content-Type': 'application/json' } },
  );
  render(<ArtPanel />);

  await userEvent.selectOptions(
    screen.getByRole('combobox'),
    '3 frames per direction, 48 px (the RPG Maker MV/MZ format)',
  );
  await userEvent.upload(screen.getByLabelText('Replace Item icons'), sheet());

  expect(sent.map((s) => s.path)).toEqual(['/admin/assets/items']);
  expect(await screen.findByRole('alert')).toHaveTextContent('64 px squares');
});

it('refuses a sheet past the limit without sending it', async () => {
  render(<ArtPanel />);

  await userEvent.upload(
    screen.getByLabelText('Replace Map tiles'),
    sheet(16 * 1024 * 1024 + 1),
  );

  expect(sent).toEqual([]);
  expect(screen.getByRole('alert')).toHaveTextContent('larger than 16 MB');
});
