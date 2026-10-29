import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasswordReset } from './PasswordReset';

const mocks = vi.hoisted(() => ({ confirmPasswordReset: vi.fn() }));

// A faithful stand-in for the real rule: the server's own sentence for a 4xx,
// a written one for anything from 500 up.
vi.mock('../io/network', () => ({
  confirmPasswordReset: mocks.confirmPasswordReset,
  fetchGameBrand: () => Promise.resolve(null),
  passwordMinLength: () => 8,
  httpError: (e: unknown) => (e ?? {}) as { status?: number },
  friendlyHttpError: (e: unknown) => {
    const { status, message } = (e ?? {}) as {
      status?: number;
      message?: string;
    };
    return status !== undefined && status < 500 && message
      ? message
      : 'Something went wrong on our side. Try again in a moment.';
  },
}));

const fill = async (password: string, repeat: string) => {
  const user = userEvent.setup();
  await user.type(screen.getByPlaceholderText('New password'), password);
  await user.type(
    screen.getByPlaceholderText('Repeat the new password'),
    repeat,
  );
  await user.click(screen.getByRole('button', { name: 'Save' }));
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.confirmPasswordReset.mockResolvedValue({ success: true });
});

describe('the screen a reset link opens', () => {
  it('sends the token with the new password', async () => {
    render(<PasswordReset token="tok-123" onDone={vi.fn()} />);

    await fill('long-enough-password', 'long-enough-password');

    expect(mocks.confirmPasswordReset).toHaveBeenCalledWith(
      'tok-123',
      'long-enough-password',
    );
    expect(screen.getByText(/you can log in now/i)).toBeInTheDocument();
  });

  // Both checks happen before the round trip, so a typo costs nothing and the
  // server is not asked to rule on a password the player cannot have meant.
  it('refuses two passwords that differ, without asking the server', async () => {
    render(<PasswordReset token="tok-123" onDone={vi.fn()} />);

    await fill('long-enough-password', 'long-enough-passwerd');

    expect(mocks.confirmPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
  });

  it('refuses one that is too short', async () => {
    render(<PasswordReset token="tok-123" onDone={vi.fn()} />);

    await fill('short', 'short');

    expect(mocks.confirmPasswordReset).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /at least 8 characters/i,
    );
  });

  it('shows what the server said when the link is spent', async () => {
    mocks.confirmPasswordReset.mockRejectedValue({
      status: 400,
      message: 'That link is no longer valid',
    });
    render(<PasswordReset token="old" onDone={vi.fn()} />);

    await fill('long-enough-password', 'long-enough-password');

    expect(screen.getByText(/no longer valid/i)).toBeInTheDocument();
  });

  // "Internal server error" is the server talking to its operator. A player
  // reads a sentence and, when there is one, the id that finds the stack.
  it('does not print a server internal when the server breaks', async () => {
    mocks.confirmPasswordReset.mockRejectedValue({
      status: 500,
      message: 'Internal server error',
    });
    render(<PasswordReset token="tok-123" onDone={vi.fn()} />);

    await fill('long-enough-password', 'long-enough-password');

    expect(
      screen.queryByText(/internal server error/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/went wrong on our side/i)).toBeInTheDocument();
  });
});
