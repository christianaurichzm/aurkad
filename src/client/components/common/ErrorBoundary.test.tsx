import { render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

const Broken = () => {
  throw new Error('boom');
};

afterEach(() => vi.unstubAllGlobals());

it('shows a way back instead of a blank page, and reports the error', () => {
  const reportError = vi.fn();
  vi.stubGlobal('reportError', reportError);
  vi.spyOn(console, 'error').mockImplementation(() => {});

  render(
    <ErrorBoundary>
      <Broken />
    </ErrorBoundary>,
  );

  expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong.');
  expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  expect(reportError).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'boom' }),
  );
});
