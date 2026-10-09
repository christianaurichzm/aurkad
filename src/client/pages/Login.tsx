import { AuthLayout } from '../components/common/AuthLayout';
import { PasswordInput } from '../components/common/PasswordInput';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  fetchAuthCapabilities,
  friendlyHttpError,
  httpError,
  login,
  requestPasswordReset,
} from '../io/network';
import { useGame } from '../GameContext';
import { useUIStore } from '../stores/uiStore';
import { colors, radius } from '../theme';
import { useT } from '../i18n';

type FormValues = {
  username: string;
  password: string;
  totpToken: string;
};

/**
 * The account name of whoever ticked "remember me" here. Only the name: this
 * page runs the server owner's module code, which can read localStorage, so
 * the password is left to the browser's password manager (autoComplete).
 */
const REMEMBERED_USER_KEY = 'engine.rememberedUser';

const readRememberedUser = (): string => {
  try {
    return localStorage.getItem(REMEMBERED_USER_KEY) ?? '';
  } catch {
    return '';
  }
};

/** `username` is an account just made on the Register screen. */
export const Login = ({
  onSwitch,
  username: created,
}: {
  onSwitch: () => void;
  username?: string;
}) => {
  const t = useT();
  const { loginSuccess } = useGame();
  const [serverError, setServerError] = useState('');
  const [onlinePlayers, setOnlinePlayers] = useState<number | null>(null);
  // Offered only when a link can arrive: with no mail transport the server
  // says no, and the message would only go to a log the player cannot read.
  const [canReset, setCanReset] = useState(false);
  const [resetName, setResetName] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const remembered = readRememberedUser();
  const [remember, setRemember] = useState(remembered !== '');
  // Shown only after the server asks for it. Nothing here can know an account
  // is enrolled before the password has been checked, and a field that is
  // always on screen would be a hint to whoever is guessing names.
  const [needsCode, setNeedsCode] = useState(false);

  const {
    register,
    handleSubmit,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { username: created ?? remembered, totpToken: '' },
  });

  useEffect(() => {
    if (created) setFocus('password');
  }, [created, setFocus]);

  useEffect(() => {
    fetchAuthCapabilities()
      .then((c) => setCanReset(c?.mail === true))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json() as Promise<{ players?: number }>)
      .then((d) => setOnlinePlayers(d.players ?? null))
      .catch(() => {});
  }, []);

  const onSubmit = async ({ username, password, totpToken }: FormValues) => {
    setServerError('');
    try {
      const data = await login(
        username,
        password,
        remember,
        totpToken.trim() || undefined,
      );
      try {
        if (remember) localStorage.setItem(REMEMBERED_USER_KEY, username);
        else localStorage.removeItem(REMEMBERED_USER_KEY);
      } catch {
        // Storage disabled: the box still applies to this login's session.
      }
      if (data?.player && data?.map) {
        loginSuccess(data);
        if (data.motd) {
          useUIStore.getState().addChatMessage({
            type: 'chat',
            scope: 'player',
            message: `📢 ${data.motd}`,
          });
        }
      } else {
        setServerError('Unexpected response from server');
      }
    } catch (err) {
      if (httpError(err).twoFactorRequired) setNeedsCode(true);
      setServerError(friendlyHttpError(err));
    }
  };

  return (
    <AuthLayout title={t('auth.login')}>
      <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
        <div style={styles.field}>
          <input
            type="text"
            autoComplete="username"
            aria-label={t('auth.username')}
            placeholder={t('auth.username')}
            style={styles.input}
            {...register('username', { required: t('auth.username') })}
          />
          {errors.username && (
            <span style={styles.fieldError}>{errors.username.message}</span>
          )}
        </div>
        <div style={styles.field}>
          <PasswordInput
            autoComplete="current-password"
            aria-label={t('auth.password')}
            placeholder={t('auth.password')}
            style={styles.input}
            {...register('password', { required: t('auth.password') })}
          />
          {errors.password && (
            <span style={styles.fieldError}>{errors.password.message}</span>
          )}
        </div>
        {needsCode && (
          <div style={styles.field}>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              aria-label={t('auth.totpCode')}
              placeholder={t('auth.totpCode')}
              style={styles.input}
              {...register('totpToken')}
            />
            <span style={styles.hint}>{t('auth.totpHint')}</span>
          </div>
        )}
        <label style={styles.remember}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t('auth.remember')}
        </label>
        <button type="submit" disabled={isSubmitting} style={styles.button}>
          {isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </button>
        {onlinePlayers !== null && (
          <p style={styles.onlineCount}>
            {t('online.count', { count: onlinePlayers })}
          </p>
        )}
        {canReset && (
          <div style={styles.reset}>
            {resetSent ? (
              <p style={styles.onlineCount}>{t('auth.resetSent')}</p>
            ) : (
              <>
                {/* The question the second username box is answering. It was
                    an aria-label alone, which reads as an unexplained field to
                    everyone who can see the screen. */}
                <p style={styles.resetTitle}>{t('auth.forgot')}</p>
                <input
                  type="text"
                  placeholder={t('auth.username')}
                  aria-label={t('auth.forgot')}
                  value={resetName}
                  onChange={(e) => setResetName(e.target.value)}
                  style={styles.input}
                />
                <button
                  type="button"
                  style={styles.linkButton}
                  onClick={() => {
                    // The answer is the same for a name that exists and one
                    // that does not, so there is nothing to wait for or branch
                    // on here either.
                    void requestPasswordReset(resetName).catch(() => {});
                    setResetSent(true);
                  }}
                >
                  {t('auth.sendResetLink')}
                </button>
              </>
            )}
          </div>
        )}
        <p style={styles.registerText}>
          {t('auth.noAccount')}{' '}
          <button type="button" onClick={onSwitch} style={styles.linkButton}>
            {t('auth.register')}
          </button>
        </p>
        {serverError && (
          <div role="alert" style={styles.error}>
            {serverError}
          </div>
        )}
      </form>
    </AuthLayout>
  );
};

const styles: Record<string, React.CSSProperties> = {
  field: {
    marginBottom: '20px',
    textAlign: 'left',
  },
  input: {
    width: '100%',
    padding: '12px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.control,
    fontSize: '1rem',
    boxSizing: 'border-box',
  },
  fieldError: {
    display: 'block',
    marginTop: '4px',
    color: colors.dangerText,
    fontSize: '0.8rem',
  },
  hint: {
    display: 'block',
    marginTop: '4px',
    color: colors.textMuted,
    fontSize: '0.8rem',
  },
  remember: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '16px',
    fontSize: '0.85rem',
    color: colors.textMuted,
    cursor: 'pointer',
    textAlign: 'left',
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
    transition: 'background-color 0.2s',
  },
  registerText: {
    marginTop: '20px',
    fontSize: '0.9rem',
  },
  linkButton: {
    background: 'none',
    border: 'none',
    color: colors.info,
    cursor: 'pointer',
    textDecoration: 'underline',
    fontSize: 'inherit',
  },
  reset: {
    marginTop: '18px',
    paddingTop: '14px',
    borderTop: `1px solid ${colors.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  onlineCount: {
    marginTop: '16px',
    fontSize: '0.85rem',
    color: colors.textMuted,
  },
  resetTitle: {
    marginBottom: '8px',
    fontSize: '0.85rem',
    color: colors.textMuted,
  },
  error: {
    marginTop: '15px',
    color: colors.dangerText,
    fontSize: '0.9rem',
  },
};
