import ReactDOM from 'react-dom/client';
import App from './App';
import { GameProvider } from './context/GameContext';
import { AdminApp } from './admin/AdminApp';
import { installErrorReporter } from './io/network/http/errorReporter';
import { fetchGameBrand } from './io/network';
import { t } from './i18n';

// Before render, so a crash while mounting is reported too.
installErrorReporter();

// The /admin path is the standalone operator dashboard (no game shell); every
// other path is the game client.
const isAdminPanel = window.location.pathname.startsWith('/admin');

const root = ReactDOM.createRoot(document.getElementById('root')!);
const render = () =>
  root.render(
    isAdminPanel ? (
      <AdminApp />
    ) : (
      <GameProvider>
        <App />
      </GameProvider>
    ),
  );

const serverUp = () =>
  fetch('/healthz').then(
    (r) => r.ok,
    () => false,
  );

// The dev client starts before the server it proxies to, and node --watch
// restarts that server on every save. theme.css and the brand are fetched
// once, so a page loaded in between waits and reloads when the server
// answers. A server that is up but failed /game renders as it is.
async function waitForServer() {
  root.render(<p className="server-wait">{t('app.serverStarting')}</p>);
  let down = false;
  while (!(await serverUp())) {
    down = true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (down) window.location.reload();
  else render();
}

// The tab and its icon are the game's; index.html carries the engine's until
// the server has said which game this is.
void fetchGameBrand().then((brand) => {
  if (!brand) return waitForServer();
  render();
  document.title = brand.name;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!icon) return;
  // The engine's icon is declared SVG, and a logo usually is not.
  icon.removeAttribute('type');
  icon.href = brand.logo;
});
