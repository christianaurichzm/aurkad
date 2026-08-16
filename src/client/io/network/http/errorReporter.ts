import { httpClient } from './httpClient';

/**
 * Sends a browser crash to the server, which logs it where an operator
 * looks. No Sentry SDK: where logs go is the operator's choice, and a
 * structured log line can reach Loki, Sentry or `docker logs` from there.
 */

// A throwing render loop throws every frame. Reporting each message once
// keeps a broken build from flooding the operator's own log.
const seen = new Set<string>();

// A page with a hundred different errors is already lost; the first few
// name the cause.
const MAX_REPORTS = 10;
let sent = 0;

function report(
  kind: 'error' | 'unhandledrejection',
  message: string,
  stack?: string,
  source?: string,
): void {
  const key = `${kind}:${message}`;
  if (seen.has(key) || sent >= MAX_REPORTS) return;
  seen.add(key);
  sent += 1;

  void httpClient('/client-error', {
    method: 'POST',
    body: {
      kind,
      message: message.slice(0, 500),
      ...(stack && { stack: stack.slice(0, 4000) }),
      ...(source && { source: source.slice(0, 500) }),
    },
    // A failed report is dropped; reporting must not throw.
  }).catch(() => undefined);
}

const onError = (event: ErrorEvent): void => {
  report(
    'error',
    event.message || 'Unknown error',
    event.error instanceof Error ? event.error.stack : undefined,
    event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : '',
  );
};

// An uncaught rejection is how every async click handler fails, and it
// only prints to a console the player never opens.
const onRejection = (event: PromiseRejectionEvent): void => {
  const reason: unknown = event.reason;
  report(
    'unhandledrejection',
    reason instanceof Error
      ? reason.message
      : String(reason).slice(0, 500) || 'Unknown rejection',
    reason instanceof Error ? reason.stack : undefined,
    window.location.pathname,
  );
};

/** Returns a function that removes both listeners again. */
export function installErrorReporter(): () => void {
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
