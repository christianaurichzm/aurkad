import { useState } from 'react';
import { ContentEditor } from './components/ContentEditor/ContentEditor';
import { GameInterface } from './components/GameInterface';
import { HudBar, LowHealthVignette, MapName } from './components/HUD/HudBar';
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
import { ChatPanel, ChatPeek } from './components/ChatPanel';
import { ActionPanel, CreatorTools } from './components/ActionPanel';
import { useGame } from './GameContext';
import { useGameBrand } from './components/common/AuthLayout';
import { useMediaQuery } from './hooks/useMediaQuery';
import { useT } from './i18n';
import { AttributeDistributorModal } from './components/AttributeDistributorModal';
import { GameCanvas } from './components/GameCanvas';
import { DialogHost } from './components/common/DialogHost';
import { OnlinePlayersModal } from './components/OnlinePlayersModal';
import { SettingsModal } from './components/SettingsModal';
import { PasswordReset } from './pages/PasswordReset';

// Screens with room for the menu beside or under the world; smaller ones
// keep their own arrangement whatever layout the game picked (styles.css).
const ARRANGEABLE = '(min-width: 901px) and (min-height: 501px)';

function App() {
  const t = useT();
  const { isLoggedIn } = useGame();
  const brand = useGameBrand();
  const layout = brand?.layout ?? 'right';
  // In the bottom and overlay layouts the hotbar is one of the shell's
  // blocks; otherwise it stays over the world, inside the frame.
  const docked =
    useMediaQuery(ARRANGEABLE) && (layout === 'bottom' || layout === 'overlay');
  const [showRegister, setShowRegister] = useState(false);
  const [registeredName, setRegisteredName] = useState<string>();
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
            data-layout={layout}
            data-art={brand?.art ?? 'pixel'}
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
                  <LowHealthVignette />
                  <MapName />
                  <QuestTracker />
                  {!docked && <Hotbar />}
                </div>
                <ChatPeek onOpen={() => setPanelCollapsed(false)} />
              </div>
              <TouchControls />
            </main>
            {docked && <Hotbar />}
            <aside id="sidePanel" aria-label={t('app.gameControls')}>
              <ActionPanel />
              <ChatPanel shown={!panelCollapsed} />
              <CreatorTools />
            </aside>
          </div>
          <ShopModal />
          <AttributeDistributorModal />
          <OnlinePlayersModal />
          <SettingsModal />
          <GMPanel />
          {brand?.inventory !== false && <InventoryPanel />}
          <TilesetEditor />
          <ContentEditor />
          <div id="module-ui" />
        </div>
      ) : resetToken ? (
        <PasswordReset token={resetToken} onDone={closeReset} />
      ) : showRegister ? (
        <Register
          onSwitch={(name) => {
            setRegisteredName(name);
            setShowRegister(false);
          }}
        />
      ) : (
        <Login
          username={registeredName}
          onSwitch={() => setShowRegister(true)}
        />
      )}
      <DialogHost />
    </>
  );
}

export default App;
