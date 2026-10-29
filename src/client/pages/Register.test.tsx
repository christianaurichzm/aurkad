import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Register } from './Register';

const mocks = vi.hoisted(() => ({ register: vi.fn() }));

// A game stricter than the defaults, so a passing check proves the form read
// game.json `account` rather than a number of its own.
vi.mock('../io/network', () => ({
  register: mocks.register,
  friendlyHttpError: (e: { message?: string }) => e?.message ?? 'failed',
  passwordMinLength: () => 10,
  fetchGameBrand: () =>
    Promise.resolve({
      name: 'Tandem',
      logo: '/favicon.svg',
      account: {
        usernameMinLength: 4,
        usernameMaxLength: 12,
        usernamePattern: '^(?:[a-z]+)$',
        passwordMinLength: 10,
      },
    }),
}));

const signUp = async (name: string, password: string, repeat = password) => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('Choose a username'), name);
  await user.type(screen.getByPlaceholderText('Choose a password'), password);
  await user.type(screen.getByPlaceholderText('Repeat the password'), repeat);
  await user.click(screen.getByRole('button', { name: 'Register' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.register.mockResolvedValue({ success: true });
});

describe('Register', () => {
  it("holds a name to the game's rules before sending it", async () => {
    render(<Register onSwitch={vi.fn()} />);
    // The rules arrive with /game; wait for the card it fills in.
    await screen.findByText('Tandem');

    await signUp('Al', 'longenough1');
    expect(await screen.findByText('At least 4 characters.')).toBeTruthy();

    await userEvent.clear(screen.getByPlaceholderText('Choose a username'));
    await userEvent.type(
      screen.getByPlaceholderText('Choose a username'),
      'Alice',
    );
    expect(
      await screen.findByText(
        'That name has characters this game does not allow.',
      ),
    ).toBeTruthy();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('states the password rule before the first try', async () => {
    render(<Register onSwitch={vi.fn()} />);
    await screen.findByText('Tandem');

    expect(
      screen
        .getByPlaceholderText('Choose a password')
        .getAttribute('aria-describedby'),
    ).toBe(screen.getByText('At least 10 characters.').id);
  });

  it('refuses a short password and a repeat that does not match', async () => {
    render(<Register onSwitch={vi.fn()} />);
    await screen.findByText('Tandem');

    await signUp('alice', 'short', 'shorter');

    expect(
      await screen.findByText('The two passwords do not match.'),
    ).toBeTruthy();
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('hands the new name to the login screen once the account exists', async () => {
    const onSwitch = vi.fn();
    render(<Register onSwitch={onSwitch} />);
    await screen.findByText('Tandem');

    await signUp('alice', 'longenough1');

    expect(mocks.register).toHaveBeenCalledWith('alice', 'longenough1');
    expect(screen.getByRole('status').textContent).toMatch(/account created/i);
    await vi.waitFor(() => expect(onSwitch).toHaveBeenCalledWith('alice'), {
      timeout: 3000,
    });
  });
});
