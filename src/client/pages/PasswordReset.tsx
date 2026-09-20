import { AuthLayout } from '../components/common/AuthLayout';
import { useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '../../shared/constants';
import {
  confirmPasswordReset,
  friendlyHttpError,
  httpError,
} from '../io/network';
import { colors, radius } from '../theme';
import { useT } from '../i18n';

/**
 * The screen a reset link opens: `/?reset=<token>`. A query string because
 * the client has no router, and a link pasted by an operator keeps it better
 * than a hash route.
 */
export const PasswordReset = ({
  token,
  onDone,
}: {
  token: string;
  onDone: () => void;
}) => {
  const t = useT();
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < PASSWORD_MIN_LENGTH) {
      return setError(t('auth.passwordTooShort', { min: PASSWORD_MIN_LENGTH }));
    }
    if (password !== repeat) return setError(t('auth.passwordMismatch'));

    setBusy(true);
    setError('');
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (e) {
      // The one refusal this screen can phrase better than the server: it
      // knows the link is spent or expired, and it can say so in the language
      // the player is reading. Anything else is worded by friendlyHttpError.
      setError(
        httpError(e).status === 400
          ? t('auth.resetFailed')
          : friendlyHttpError(e),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('auth.resetTitle')}>
      <form
        className="auth-form"
        style={styles.form}
        onSubmit={(e) => void submit(e)}
      >
        {done ? (
          <>
            <p style={styles.done}>{t('auth.resetDone')}</p>
            <button type="button" style={styles.button} onClick={onDone}>
              {t('auth.backToLogin')}
            </button>
          </>
        ) : (
          <>
            <input
              type="password"
              autoFocus
              aria-label={t('auth.newPassword')}
              placeholder={t('auth.newPassword')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
            />
            <input
              type="password"
              aria-label={t('auth.repeatPassword')}
              placeholder={t('auth.repeatPassword')}
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              style={styles.input}
            />
            <button type="submit" disabled={busy} style={styles.button}>
              {busy ? t('common.loading') : t('common.save')}
            </button>
            <button type="button" style={styles.linkButton} onClick={onDone}>
              {t('auth.backToLogin')}
            </button>
          </>
        )}

        {error && (
          <div role="alert" style={styles.error}>
            {error}
          </div>
        )}
      </form>
    </AuthLayout>
  );
};

const styles: Record<string, React.CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  input: {
    width: '100%',
    padding: '12px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    fontSize: '1rem',
    boxSizing: 'border-box',
  },
  button: {
    width: '100%',
    padding: '12px',
    backgroundColor: colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: radius.sm,
    cursor: 'pointer',
    fontSize: '1rem',
    fontWeight: 'bold',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: colors.info,
    cursor: 'pointer',
    textDecoration: 'underline',
    fontSize: '0.9rem',
  },
  done: {
    margin: 0,
    fontSize: '0.95rem',
    color: colors.textMuted,
  },
  error: {
    color: colors.dangerText,
    fontSize: '0.9rem',
  },
};
