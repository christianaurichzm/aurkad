import React, { useCallback, useEffect, useState } from 'react';
import {
  beginTwoFactor,
  confirmTwoFactor,
  fetchTwoFactor,
  friendlyHttpError,
  removeTwoFactor,
  type TwoFactorStatus,
} from '../../io/network';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

/**
 * The operator's own second factor, enrolled from the panel it protects.
 * The key is shown as text with an `otpauth:` link, since a QR encoder
 * would ship to every player. Recovery codes are shown once and never again.
 */
type Mode = 'view' | 'password' | 'confirm' | 'codes' | 'disable';

const LOW_RECOVERY = 3;

export const TwoFactorPanel: React.FC = () => {
  const t = useT();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [mode, setMode] = useState<Mode>('view');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [enrollment, setEnrollment] = useState<{
    secret: string;
    otpauthUrl: string;
  } | null>(null);
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetchTwoFactor()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  useEffect(() => load(), [load]);

  const reset = (next: Mode = 'view') => {
    setMode(next);
    setPassword('');
    setCode('');
    setError('');
    setEnrollment(null);
  };

  /** Every step has one shape: try it, show what the server said, reload. */
  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await step();
    } catch (e: unknown) {
      setError(friendlyHttpError(e));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const started = await beginTwoFactor(password);
      if (!started) return;
      setEnrollment(started);
      setPassword('');
      setMode('confirm');
    });

  const finish = () =>
    run(async () => {
      const done = await confirmTwoFactor(code.trim());
      if (!done) return;
      setCodes(done.recoveryCodes);
      setCode('');
      setEnrollment(null);
      setMode('codes');
      load();
    });

  const turnOff = () =>
    run(async () => {
      await removeTwoFactor(password, code.trim());
      reset();
      load();
    });

  return (
    <div style={wrap}>
      {mode === 'view' && (
        <>
          <div style={status?.enabled ? lineOn : lineOff}>
            {status?.enabled
              ? t('twofa.on', { count: status.recoveryLeft })
              : t('twofa.off')}
          </div>
          {status?.enabled && status.recoveryLeft <= LOW_RECOVERY && (
            <div style={warn}>{t('twofa.lowRecovery')}</div>
          )}
          <div style={row}>
            <button
              style={button}
              onClick={() => reset(status?.enabled ? 'disable' : 'password')}
            >
              {status?.enabled ? t('twofa.turnOff') : t('twofa.setUp')}
            </button>
          </div>
          {status?.enabled && <div style={hint}>{t('twofa.lockedOut')}</div>}
        </>
      )}

      {(mode === 'password' || mode === 'disable') && (
        <>
          <div style={hint}>{t('twofa.passwordHint')}</div>
          <input
            style={input}
            type="password"
            autoComplete="current-password"
            placeholder={t('auth.currentPassword')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {mode === 'disable' && (
            <input
              style={input}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={t('auth.totpCode')}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
          <div style={row}>
            <button
              style={button}
              disabled={busy || !password}
              onClick={() => void (mode === 'disable' ? turnOff() : start())}
            >
              {mode === 'disable' ? t('twofa.turnOff') : t('twofa.setUp')}
            </button>
            <button style={quietButton} onClick={() => reset()}>
              {t('twofa.cancel')}
            </button>
          </div>
        </>
      )}

      {mode === 'confirm' && enrollment && (
        <>
          <div style={hint}>{t('twofa.keyHint')}</div>
          <code style={secretBox}>{enrollment.secret}</code>
          <div style={hint}>{t('twofa.linkHint')}</div>
          <a style={link} href={enrollment.otpauthUrl}>
            {enrollment.otpauthUrl}
          </a>
          <div style={hint}>{t('twofa.codeHint')}</div>
          <input
            style={input}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            placeholder={t('auth.totpCode')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <div style={row}>
            <button
              style={button}
              disabled={busy || !code}
              onClick={() => void finish()}
            >
              {t('twofa.confirm')}
            </button>
            <button style={quietButton} onClick={() => reset()}>
              {t('twofa.cancel')}
            </button>
          </div>
        </>
      )}

      {mode === 'codes' && (
        <>
          <div style={warn}>{t('twofa.saveCodes')}</div>
          <div style={codeGrid}>
            {codes.map((one) => (
              <code key={one} style={codeCell}>
                {one}
              </code>
            ))}
          </div>
          <div style={row}>
            <button style={button} onClick={() => reset()}>
              {t('twofa.done')}
            </button>
          </div>
        </>
      )}

      {error && <div style={errorLine}>{error}</div>}
    </div>
  );
};

const wrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const row: React.CSSProperties = { display: 'flex', gap: 8 };

const lineOn: React.CSSProperties = { fontSize: 13, color: colors.text };

const lineOff: React.CSSProperties = { fontSize: 13, color: colors.danger };

const hint: React.CSSProperties = { fontSize: 12, color: colors.textMuted };

const warn: React.CSSProperties = {
  fontSize: 12,
  color: colors.text,
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: 8,
};

const input: React.CSSProperties = {
  padding: '8px 10px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 13,
};

const button: React.CSSProperties = {
  background: colors.primary,
  color: colors.surface,
  border: 'none',
  padding: '8px 14px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontSize: 13,
};

const quietButton: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '8px 14px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontSize: 13,
};

const secretBox: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 14,
  letterSpacing: 1,
  wordBreak: 'break-all',
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: 8,
};

const link: React.CSSProperties = {
  fontSize: 11,
  color: colors.primary,
  wordBreak: 'break-all',
};

const codeGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
  gap: 6,
};

const codeCell: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 13,
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: '4px 6px',
  textAlign: 'center',
};

const errorLine: React.CSSProperties = { fontSize: 12, color: colors.danger };
