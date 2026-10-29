import { AuthLayout, useGameBrand } from '../components/common/AuthLayout';
import { PasswordInput } from '../components/common/PasswordInput';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  friendlyHttpError,
  passwordMinLength,
  register as registerUser,
} from '../io/network';
import { colors, radius } from '../theme';
import { useT } from '../i18n';

type FormValues = { username: string; password: string; repeat: string };

/** How long "account created" stays up before the login screen takes over. */
const HANDOFF_MS = 1200;

/**
 * `onSwitch` gets the new account's name once one is made, so the login screen
 * opens with it filled in.
 */
export const Register = ({
  onSwitch,
}: {
  onSwitch: (username?: string) => void;
}) => {
  const t = useT();
  // game.json `account`. Until /game answers only "required" is checked here;
  // the server applies the same rules either way.
  const account = useGameBrand()?.account;
  const [serverError, setServerError] = useState('');
  const [created, setCreated] = useState('');

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  useEffect(() => {
    if (!created) return;
    const timer = setTimeout(() => onSwitch(created), HANDOFF_MS);
    return () => clearTimeout(timer);
  }, [created, onSwitch]);

  const onSubmit = async ({ username, password }: FormValues) => {
    setServerError('');
    try {
      await registerUser(username, password);
      setCreated(username);
    } catch (err) {
      setServerError(friendlyHttpError(err));
    }
  };

  const minPassword = passwordMinLength();

  return (
    <AuthLayout title={t('auth.register')}>
      {created ? (
        <div className="auth-handoff" role="status">
          <span className="auth-spinner" aria-hidden="true" />
          <p className="auth-handoff-title">{t('auth.accountCreated')}</p>
          <p className="auth-handoff-note">{t('auth.openingLogin')}</p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
          <div style={styles.field}>
            <input
              type="text"
              autoComplete="username"
              aria-label={t('auth.chooseUsername')}
              placeholder={t('auth.chooseUsername')}
              style={styles.input}
              {...register('username', {
                required: t('auth.usernameRequired'),
                ...(account && {
                  minLength: {
                    value: account.usernameMinLength,
                    message: t('auth.usernameTooShort', {
                      min: account.usernameMinLength,
                    }),
                  },
                  maxLength: {
                    value: account.usernameMaxLength,
                    message: t('auth.usernameTooLong', {
                      max: account.usernameMaxLength,
                    }),
                  },
                  pattern: {
                    value: new RegExp(account.usernamePattern, 'u'),
                    message: t('auth.usernameChars'),
                  },
                }),
              })}
            />
            {errors.username && (
              <span style={styles.fieldError}>{errors.username.message}</span>
            )}
          </div>
          <div style={styles.field}>
            <PasswordInput
              autoComplete="new-password"
              aria-label={t('auth.choosePassword')}
              placeholder={t('auth.choosePassword')}
              aria-describedby="register-password-rule"
              style={styles.input}
              {...register('password', {
                required: t('auth.passwordRequired'),
                minLength: {
                  value: minPassword,
                  message: t('auth.passwordTooShort', { min: minPassword }),
                },
              })}
            />
            <span
              id="register-password-rule"
              style={errors.password ? styles.fieldError : styles.fieldHint}
            >
              {errors.password?.message ??
                t('auth.passwordTooShort', { min: minPassword })}
            </span>
          </div>
          <div style={styles.field}>
            <PasswordInput
              autoComplete="new-password"
              aria-label={t('auth.confirmPassword')}
              placeholder={t('auth.confirmPassword')}
              style={styles.input}
              {...register('repeat', {
                validate: (repeat) =>
                  repeat === getValues('password') ||
                  t('auth.passwordMismatch'),
              })}
            />
            {errors.repeat && (
              <span style={styles.fieldError}>{errors.repeat.message}</span>
            )}
          </div>
          <button type="submit" disabled={isSubmitting} style={styles.button}>
            {isSubmitting && (
              <span className="auth-spinner small" aria-hidden="true" />
            )}
            {isSubmitting ? t('auth.registering') : t('auth.register')}
          </button>
          <p style={styles.switchText}>
            {t('auth.hasAccount')}{' '}
            <button
              type="button"
              onClick={() => onSwitch()}
              style={styles.linkButton}
            >
              {t('auth.login')}
            </button>
          </p>
          {serverError && (
            <div role="alert" style={styles.error}>
              {serverError}
            </div>
          )}
        </form>
      )}
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
  fieldHint: {
    display: 'block',
    marginTop: '4px',
    color: colors.textMuted,
    fontSize: '0.8rem',
  },
  button: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
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
  switchText: {
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
  error: {
    marginTop: '15px',
    color: colors.dangerText,
    fontSize: '0.9rem',
  },
};
