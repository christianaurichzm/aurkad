import { AuthLayout } from '../components/common/AuthLayout';
import { PasswordInput } from '../components/common/PasswordInput';
import { useState } from 'react';
import {
  confirmPasswordReset,
  friendlyHttpError,
  passwordMinLength,
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
    const min = passwordMinLength();
    if (password.length < min) {
      return setError(t('auth.passwordTooShort', { min }));
    }
    if (password !== repeat) return setError(t('auth.passwordMismatch'));

    setBusy(true);
    setError('');
    try {
      await confirmPasswordReset(token, password);
      setDone(true);
    } catch (e) {
      // A spent link and a password the server refuses are both a 400, told
      // apart only by the sentence the server sends.
      setError(friendlyHttpError(e));
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
            <PasswordInput
              autoFocus
              aria-label={t('auth.newPassword')}
              placeholder={t('auth.newPassword')}
              aria-describedby="reset-password-rule"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={styles.input}
            />
            <span id="reset-password-rule" style={styles.hint}>
              {t('auth.passwordTooShort', { min: passwordMinLength() })}
            </span>
            <PasswordInput
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
  hint: { marginTop: -8, color: colors.textMuted, fontSize: '0.8rem' },
  input: {
    width: '100%',
    padding: '12px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.control,
    fontSize: '1rem',
    boxSizing: 'border-box',
  },
  button: {
    width: '100%',
    padding: '12px',
    backgroundColor: colors.primary,
    color: 'white',
    border: 'none',
    borderRadius: radius.control,
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
