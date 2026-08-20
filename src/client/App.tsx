import { useState } from 'react';
import { ContentEditor } from './components/ContentEditor/ContentEditor';
import { GameInterface } from './components/GameInterface';
import { HudBar } from './components/HUD/HudBar';
import { TouchControls } from './components/HUD/TouchControls';
import { InventoryPanel } from './components/Inventory/InventoryPanel';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { ShopModal } from './components/Shop/ShopModal';
import { QuestTracker } from './components/Quest/QuestTracker';
import { TilesetEditor } from './components/Tileset/TilesetEditor';
import { GMPanel } from './components/GMPanel';
import { ChatPanel } from './components/ChatPanel';
import { ActionPanel } from './components/ActionPanel';
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
          <div id="gameShell">
            <main id="gameMain" aria-label={t('app.gameMap')}>
              <div id="canvasFrame">
                <GameCanvas />
                <GameInterface />
                <QuestTracker />
                <TouchControls />
              </div>
            </main>
            <aside id="sidePanel" aria-label={t('app.gameControls')}>
              <HudBar />
              <ActionPanel />
              <ChatPanel />
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
