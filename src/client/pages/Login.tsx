import { useState } from 'react';
import { login } from '../io/network';
import { setAssetKey } from '../io/assets';
import { MapStateClient, Player } from '../../shared/types';
import { useGame } from '../context/GameContext';
import { useUIStore } from '../stores/uiStore';
import { colors, radius, zIndex } from '../theme';

export const Login = ({ onSwitch }: { onSwitch: () => void }) => {
  const { loginSuccess } = useGame();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }

    try {
      const data = await login(username, password);

      if (data?.player && data?.map && data?.assetKey) {
        setAssetKey(data.assetKey);
        loginSuccess(data as { map: MapStateClient; player: Player });
        if (data.motd) {
          useUIStore.getState().addChatMessage({
            type: 'chat',
            scope: 'player',
            message: `📢 ${data.motd}`,
          });
        }
      } else {
        setError('Invalid response from server');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div style={styles.container}>
      <form style={styles.form} onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="User"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          style={styles.input}
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          style={styles.input}
        />
        <button
          type="submit"
          disabled={!username || !password}
          style={styles.button}
        >
          Login
        </button>
        <p style={styles.registerText}>
          Don't have an account?{' '}
          <button type="button" onClick={onSwitch} style={styles.linkButton}>
            Register
          </button>
        </p>
        {error && <div style={styles.error}>{error}</div>}
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
  input: {
    width: '100%',
    padding: '12px',
    marginBottom: '20px',
    border: `1px solid ${colors.border}`,
    borderRadius: radius.sm,
    fontSize: '1rem',
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
  error: {
    marginTop: '15px',
    color: colors.danger,
    fontSize: '0.9rem',
  },
};
