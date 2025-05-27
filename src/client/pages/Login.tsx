import { useState } from 'react';
import { login } from '../io/network';
import { MapStateClient, Player } from '../../shared/types';
import { useGame } from '../context/GameContext';

export const Login = () => {
  const { loginSuccess } = useGame();
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      const data = await login(username);
      loginSuccess(data as { map: MapStateClient; player: Player });
    } catch (err) {
      console.error(err);
      if (err instanceof Error) setError(err.message);
      else setError('Unknown error during login');
    }
  };

  return (
    <div id="loginContainer">
      <form id="loginForm" onSubmit={handleSubmit}>
        <input
          id="username"
          type="text"
          placeholder="User"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button type="submit">Login</button>
        {error && <div id="errorMessage">{error}</div>}
      </form>
    </div>
  );
};
