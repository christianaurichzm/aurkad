import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { httpError, login } from '../io/network';
import { setAssetKey } from '../io/assets';
import { useGame } from '../context/GameContext';
import { useUIStore } from '../stores/uiStore';
import { colors, radius, zIndex } from '../theme';
import { useT } from '../i18n';

type FormValues = { username: string; password: string };

export const Login = ({ onSwitch }: { onSwitch: () => void }) => {
  const t = useT();
  const { loginSuccess } = useGame();
  const [serverError, setServerError] = useState('');
  const [onlinePlayers, setOnlinePlayers] = useState<number | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>();

  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json() as Promise<{ players?: number }>)
      .then((d) => setOnlinePlayers(d.players ?? null))
      .catch(() => {});
  }, []);

  const onSubmit = async ({ username, password }: FormValues) => {
    setServerError('');
    try {
      const data = await login(username, password);
      if (data?.player && data?.map && data?.assetKey) {
        setAssetKey(data.assetKey);
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
      setServerError(httpError(err).message || 'Login failed');
    }
  };

  return (
    <div style={styles.container}>
      <form style={styles.form} onSubmit={handleSubmit(onSubmit)}>
        <div style={styles.field}>
          <input
            type="text"
            placeholder={t('auth.username')}
            style={styles.input}
            {...register('username', { required: t('auth.username') })}
          />
          {errors.username && (
            <span style={styles.fieldError}>{errors.username.message}</span>
          )}
        </div>
        <div style={styles.field}>
          <input
            type="password"
            placeholder={t('auth.password')}
            style={styles.input}
            {...register('password', { required: t('auth.password') })}
          />
          {errors.password && (
            <span style={styles.fieldError}>{errors.password.message}</span>
          )}
        </div>
        <button type="submit" disabled={isSubmitting} style={styles.button}>
          {isSubmitting ? t('auth.loggingIn') : t('auth.login')}
        </button>
        {onlinePlayers !== null && (
          <p style={styles.onlineCount}>
            {t('online.count', { count: onlinePlayers })}
          </p>
        )}
        <p style={styles.registerText}>
          {t('auth.noAccount')}{' '}
          <button type="button" onClick={onSwitch} style={styles.linkButton}>
            {t('auth.register')}
          </button>
        </p>
        {serverError && <div style={styles.error}>{serverError}</div>}
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
  onlineCount: {
    marginTop: '16px',
    fontSize: '0.85rem',
    color: colors.textMuted,
  },
  error: {
    marginTop: '15px',
    color: colors.danger,
    fontSize: '0.9rem',
  },
};
