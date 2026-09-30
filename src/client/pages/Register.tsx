import { AuthLayout } from '../components/common/AuthLayout';
import { PasswordInput } from '../components/common/PasswordInput';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { friendlyHttpError, register as registerUser } from '../io/network';
import { colors, radius } from '../theme';
import { useT } from '../i18n';

type FormValues = { username: string; password: string };

export const Register = ({ onSwitch }: { onSwitch: () => void }) => {
  const t = useT();
  const [serverError, setServerError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  useEffect(() => {
    if (!successMsg) return;
    const t = setTimeout(onSwitch, 1500);
    return () => clearTimeout(t);
  }, [successMsg, onSwitch]);

  const onSubmit = async ({ username, password }: FormValues) => {
    setServerError('');
    try {
      await registerUser(username, password);
      setSuccessMsg(t('auth.accountCreated'));
    } catch (err) {
      setServerError(friendlyHttpError(err));
    }
  };

  return (
    <AuthLayout title={t('auth.register')}>
      <form className="auth-form" onSubmit={handleSubmit(onSubmit)}>
        <div style={styles.field}>
          <input
            type="text"
            autoComplete="username"
            aria-label={t('auth.chooseUsername')}
            placeholder={t('auth.chooseUsername')}
            style={styles.input}
            {...register('username', {
              required: 'Username is required',
              maxLength: {
                value: 24,
                message: 'Username must be 24 characters or fewer',
              },
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
            style={styles.input}
            {...register('password', { required: 'Password is required' })}
          />
          {errors.password && (
            <span style={styles.fieldError}>{errors.password.message}</span>
          )}
        </div>
        <button type="submit" disabled={isSubmitting} style={styles.button}>
          {isSubmitting ? t('auth.registering') : t('auth.register')}
        </button>
        <p style={styles.switchText}>
          {t('auth.hasAccount')}{' '}
          <button type="button" onClick={onSwitch} style={styles.linkButton}>
            {t('auth.login')}
          </button>
        </p>
        {serverError && (
          <div role="alert" style={styles.error}>
            {serverError}
          </div>
        )}
        {successMsg && <div style={styles.success}>{successMsg}</div>}
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
  success: {
    marginTop: '15px',
    color: colors.info,
    fontSize: '0.9rem',
  },
};
