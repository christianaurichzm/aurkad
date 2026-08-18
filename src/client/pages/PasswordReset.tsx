import { useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '../../shared/constants';
import {
  confirmPasswordReset,
  friendlyHttpError,
  httpError,
} from '../io/network';
import { colors, radius, zIndex } from '../theme';
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
    <div style={styles.container}>
      <form style={styles.form} onSubmit={(e) => void submit(e)}>
        <h1 style={styles.title}>{t('auth.resetTitle')}</h1>

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
              placeholder={t('auth.newPassword')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
            />
            <input
              type="password"
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

        {error && <div style={styles.error}>{error}</div>}
      </form>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    inset: 0,
    backgroundColor: '#f0f0f0',
    zIndex: zIndex.auth,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
  },
  form: {
    background: colors.surface,
    padding: '40px 30px',
    borderRadius: radius.lg,
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.1)',
    width: '320px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  title: {
    margin: 0,
    fontSize: '1.15rem',
  },
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
    color: colors.danger,
    fontSize: '0.9rem',
  },
};
