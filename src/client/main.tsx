import ReactDOM from 'react-dom/client';
import App from './App';
import { GameProvider } from './context/GameContext';
import { AdminApp } from './admin/AdminApp';
import { installErrorReporter } from './io/network/http/errorReporter';
import { fetchGameBrand } from './io/network';

// Before render, so a crash while mounting is reported too.
installErrorReporter();

// The tab and its icon are the game's; index.html carries the engine's until
// the server has said which game this is.
void fetchGameBrand().then((brand) => {
  if (!brand) return;
  document.title = brand.name;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) return;
  // The engine's icon is declared SVG, and a logo usually is not.
  icon.removeAttribute('type');
  icon.href = brand.logo;
});

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
