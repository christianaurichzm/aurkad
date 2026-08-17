import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { httpError, register as registerUser } from '../io/network';
import { colors, radius, zIndex } from '../theme';
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
      setServerError(httpError(err).message || 'Registration failed');
    }
  };

  return (
    <div style={styles.container}>
      <form style={styles.form} onSubmit={handleSubmit(onSubmit)}>
        <div style={styles.field}>
          <input
            type="text"
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
          <input
            type="password"
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
        {serverError && <div style={styles.error}>{serverError}</div>}
        {successMsg && <div style={styles.success}>{successMsg}</div>}
      </form>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
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
  },
  field: {
    marginBottom: '20px',
    textAlign: 'left',
  },
  input: {
    width: '100%',
    padding: '12px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    fontSize: '1rem',
    boxSizing: 'border-box',
  },
  fieldError: {
    display: 'block',
    marginTop: '4px',
    color: colors.danger,
    fontSize: '0.8rem',
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
    color: colors.danger,
    fontSize: '0.9rem',
  },
  success: {
    marginTop: '15px',
    color: colors.primary,
    fontSize: '0.9rem',
  },
};
