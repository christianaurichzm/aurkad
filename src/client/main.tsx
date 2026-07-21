import ReactDOM from 'react-dom/client';
import App from './App';
import { GameProvider } from './context/GameContext';
import { AdminApp } from './admin/AdminApp';

// The /admin path is the standalone operator dashboard (no game shell); every
// other path is the game client.
const isAdminPanel = window.location.pathname.startsWith('/admin');

ReactDOM.createRoot(document.getElementById('root')!).render(
  isAdminPanel ? (
    <AdminApp />
  ) : (
    <GameProvider>
      <App />
    </GameProvider>
  ),
);
