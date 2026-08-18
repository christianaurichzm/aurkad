import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Login } from './Login';

const mocks = vi.hoisted(() => ({ login: vi.fn(), loginSuccess: vi.fn() }));

vi.mock('../io/network', () => ({
  login: mocks.login,
  httpError: (e: unknown) => (e as { message?: string }) ?? {},
  // No mail transport here, so the reset form stays hidden, as by default.
  fetchAuthCapabilities: () => Promise.resolve({ mail: false }),
  requestPasswordReset: vi.fn(),
}));

vi.mock('../context/GameContext', () => ({
  useGame: () => ({ loginSuccess: mocks.loginSuccess }),
}));

vi.mock('../io/assets', () => ({ setAssetKey: vi.fn() }));

const signIn = async (user: string, password: string, remember: boolean) => {
  const it = userEvent.setup();
  // Empty means "leave what is already there", which is the remembered name.
  if (user) await it.type(screen.getByPlaceholderText('Username'), user);
  await it.type(screen.getByPlaceholderText('Password'), password);
  const box = screen.getByRole<HTMLInputElement>('checkbox');
  if (box.checked !== remember) await it.click(box);
  await it.click(screen.getByRole('button', { name: 'Login' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.login.mockResolvedValue(null);
});

describe('remember me', () => {
  it('is off for a first visit, and asks the server for nothing extra', async () => {
    render(<Login onSwitch={vi.fn()} />);

    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(false);

    await signIn('Alice', 'correcthorse', false);

    expect(mocks.login).toHaveBeenCalledWith('Alice', 'correcthorse', false);
    expect(localStorage.getItem('engine.rememberedUser')).toBeNull();
  });

  // The name, never the password: this page runs alongside module code the
  // server owner wrote, and localStorage is readable by all of it.
  it('remembers the account name and asks for a session that outlives the tab', async () => {
    render(<Login onSwitch={vi.fn()} />);

    await signIn('Alice', 'correcthorse', true);

    expect(mocks.login).toHaveBeenCalledWith('Alice', 'correcthorse', true);
    expect(localStorage.getItem('engine.rememberedUser')).toBe('Alice');
  });

  it('comes back with the name filled in and the box already ticked', () => {
    localStorage.setItem('engine.rememberedUser', 'Alice');

    render(<Login onSwitch={vi.fn()} />);

    expect(
      screen.getByPlaceholderText<HTMLInputElement>('Username').value,
    ).toBe('Alice');
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
  });

  it('forgets the name when the box is cleared', async () => {
    localStorage.setItem('engine.rememberedUser', 'Alice');
    render(<Login onSwitch={vi.fn()} />);

    await signIn('', 'correcthorse', false);

    expect(localStorage.getItem('engine.rememberedUser')).toBeNull();
  });
});
