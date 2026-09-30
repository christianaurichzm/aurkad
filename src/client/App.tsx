import { useState } from 'react';
import { ContentEditor } from './components/ContentEditor/ContentEditor';
import { GameInterface } from './components/GameInterface';
import { HudBar, MapName } from './components/HUD/HudBar';
import { Hotbar } from './components/HUD/Hotbar';
import { TouchControls } from './components/HUD/TouchControls';
import { Icon } from './components/common/Icon';
import { InventoryPanel } from './components/Inventory/InventoryPanel';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ShopModal } from './components/Shop/ShopModal';
import { QuestTracker } from './components/Quest/QuestTracker';
import { TilesetEditor } from './components/Tileset/TilesetEditor';
import { GMPanel } from './components/GMPanel';
import { ChatPanel } from './components/ChatPanel';
import { ActionPanel, CreatorTools } from './components/ActionPanel';
import { useGame } from './context/GameContext';
import { useT } from './i18n';
import { AttributeDistributorModal } from './components/AttributeDistributorModal';
import { GameCanvas } from './components/GameCanvas';
import { DialogHost } from './components/common/DialogHost';
import { OnlinePlayersModal } from './components/OnlinePlayersModal';
import { SettingsModal } from './components/SettingsModal';
import { PasswordReset } from './pages/PasswordReset';

function App() {
  const t = useT();
  const { isLoggedIn } = useGame();
  const [showRegister, setShowRegister] = useState(false);
  // Only a small screen collapses the panel, opening it over the world, so
  // it starts closed.
  const [panelCollapsed, setPanelCollapsed] = useState(true);
  const togglePanel = () => setPanelCollapsed((collapsed) => !collapsed);
  // A reset link arrives as `/?reset=<token>`, read once on mount and dropped
  // from the address bar when the screen closes.
  const [resetToken, setResetToken] = useState(() =>
    new URLSearchParams(window.location.search).get('reset'),
  );

  const closeReset = () => {
    setResetToken(null);
    window.history.replaceState(null, '', window.location.pathname);
  };

  return (
    <>
      {isLoggedIn ? (
        <div id="ui">
          <div
            id="gameShell"
            className={panelCollapsed ? 'panel-collapsed' : ''}
          >
            <header id="playerBar">
              <HudBar />
              <nav
                className="player-controls"
                aria-label={t('app.gameControls')}
              >
                <button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(new Event('toggleSettings'))
                  }
                  aria-label={t('actions.settings')}
                  title={t('actions.settings')}
                >
                  <Icon name="settings" />
                </button>
                <button
                  type="button"
                  className="panel-toggle"
                  onClick={togglePanel}
                  aria-expanded={!panelCollapsed}
                  aria-controls="sidePanel"
                  aria-label={t(
                    panelCollapsed ? 'app.expandPanel' : 'app.collapsePanel',
                  )}
                >
                  <Icon name={panelCollapsed ? 'menu' : 'close'} />
                  <span>{t('app.menu')}</span>
                </button>
              </nav>
            </header>
            <main id="gameMain" aria-label={t('app.gameMap')}>
              <div className="viewport-stage">
                <div id="canvasFrame">
                  <GameCanvas />
                  <GameInterface />
                  <MapName />
                  <QuestTracker />
                  <Hotbar />
                </div>
              </div>
              <TouchControls />
            </main>
            <aside id="sidePanel" aria-label={t('app.gameControls')}>
              <ActionPanel />
              <ChatPanel />
              <CreatorTools />
            </aside>
          </div>
          <ShopModal />
          <AttributeDistributorModal />
          <OnlinePlayersModal />
          <SettingsModal />
          <GMPanel />
          <InventoryPanel />
          <TilesetEditor />
          <ContentEditor />
          <div id="module-ui" />
        </div>
      ) : resetToken ? (
        <PasswordReset token={resetToken} onDone={closeReset} />
      ) : showRegister ? (
        <Register onSwitch={() => setShowRegister(false)} />
      ) : (
        <Login onSwitch={() => setShowRegister(true)} />
      )}
      <DialogHost />
    </>
  );
}

export default App;
