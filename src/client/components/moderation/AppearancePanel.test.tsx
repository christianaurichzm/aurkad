import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppearancePanel } from './AppearancePanel';

// The real clients over a fetch that answers like the server, so the
// assertions check what goes on the wire.

type Sent = { method: string; path: string; type: string; body: unknown };

let stored: Record<string, unknown>;
let sent: Sent[];
let handwritten: boolean;

beforeEach(() => {
  stored = { colors: {}, layout: 'right', dialogDim: true };
  sent = [];
  handwritten = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, init: RequestInit) => {
      const method = init.method ?? 'GET';
      const headers = init.headers as Record<string, string>;
      const { body } = init;
      if (method !== 'GET')
        sent.push({ method, path, type: headers['Content-Type'] ?? '', body });
      if (path === '/admin/theme/logo')
        stored =
          method === 'PUT'
            ? { ...stored, logo: 'logo-0123abcd.png' }
            : { ...stored, logo: undefined };
      else if (method === 'PUT')
        stored = {
          ...(JSON.parse(body as string) as object),
          logo: stored.logo,
        };
      return Promise.resolve(
        new Response(
          JSON.stringify(
            path === '/game'
              ? { name: 'Tandem', logo: '/favicon.svg', layout: 'right' }
              : method === 'GET'
                ? { theme: stored, handwritten }
                : stored,
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const preview = () =>
  document.querySelector<HTMLElement>('.appearance-preview')!;
const variable = (name: string) => preview().style.getPropertyValue(name);

describe('AppearancePanel', () => {
  it('previews a starting point at once and saves it when asked', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);
    const save = await screen.findByRole('button', { name: 'Save appearance' });
    expect(save).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Parchment' }));

    expect(variable('--color-primary')).toBe('#8a6a1c');
    expect(variable('--color-border')).toContain('color-mix');
    expect(variable('--radius-control')).toBe('4px');
    expect(sent).toEqual([]);

    await user.click(save);

    expect(await screen.findByRole('status')).toHaveTextContent('Saved.');
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0].body as string)).toMatchObject({
      colors: { primary: '#8a6a1c' },
      corners: 'soft',
      font: 'serif',
      layout: 'right',
    });
    expect(save).toBeDisabled();
  });

  it('clears one colour back to the engine and puts the menu elsewhere', async () => {
    stored = { ...stored, colors: { primary: '#aa5500', text: '#ffffff' } };
    const user = userEvent.setup();
    render(<AppearancePanel />);

    await user.click(
      await screen.findByRole('button', { name: 'Reset Primary' }),
    );
    await user.click(
      screen.getByRole('radio', { name: 'In a bar under the world' }),
    );

    expect(variable('--color-primary')).toBe('');
    expect(variable('--color-text')).toBe('#ffffff');
    expect(document.querySelector('.appearance-game')).toHaveAttribute(
      'data-layout',
      'bottom',
    );
    expect(screen.getByText(/takes its height from the world/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));

    expect(variable('--color-primary')).toBe('#aa5500');
  });

  it('sends a picture as its bytes, saved apart from an unsaved draft', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);
    await user.click(await screen.findByRole('button', { name: 'Forest' }));
    const file = new File([new Uint8Array([0x89, 0x50])], 'mark.png', {
      type: 'image/png',
    });

    await user.upload(screen.getByLabelText('Upload Logo'), file);

    const remove = await screen.findByRole('button', { name: 'Remove: Logo' });
    expect(sent).toEqual([
      {
        method: 'PUT',
        path: '/admin/theme/logo',
        type: 'image/png',
        body: file,
      },
    ]);
    expect(preview().querySelector('img')).toHaveAttribute(
      'src',
      '/theme/logo-0123abcd.png',
    );
    // The draft is still Forest and still to be saved.
    expect(variable('--color-primary')).toBe('#3f8f4f');
    expect(
      screen.getByRole('button', { name: 'Save appearance' }),
    ).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Save appearance' }));
    await screen.findByRole('status');
    expect(JSON.parse(sent[1].body as string)).not.toHaveProperty('logo');

    await user.click(remove);
    expect(
      await screen.findByText('Logo', { selector: 'label' }),
    ).toBeInTheDocument();
    expect(sent[2]).toMatchObject({
      method: 'DELETE',
      path: '/admin/theme/logo',
    });
    expect(screen.queryByRole('button', { name: 'Remove: Logo' })).toBeNull();
  });

  it('refuses a picture past the limit before sending it', async () => {
    const user = userEvent.setup();
    render(<AppearancePanel />);
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    });

    await user.upload(
      await screen.findByLabelText('Upload Login background'),
      big,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('larger than 2 MB');
    expect(sent).toEqual([]);
  });

  it('says so when a theme.css written by hand is in the way', async () => {
    handwritten = true;
    render(<AppearancePanel />);

    expect(await screen.findByText(/theme\.css wins/)).toBeVisible();
  });
});
