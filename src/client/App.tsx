import { useState } from 'react';
import { ContentEditor } from './components/ContentEditor/ContentEditor';
import { GameInterface } from './components/GameInterface';
import { HudBar } from './components/HUD/HudBar';
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
import { AttributeDistributorModal } from './components/AttributeDistributorModal';
import { GameCanvas } from './components/GameCanvas';
import { DialogHost } from './components/common/DialogHost';
import { OnlinePlayersModal } from './components/OnlinePlayersModal';
import { SettingsModal } from './components/SettingsModal';

function App() {
  const { isLoggedIn } = useGame();
  const [showRegister, setShowRegister] = useState(false);

  return (
    <>
      {isLoggedIn ? (
        <div id="ui">
          <div id="gameShell">
            <main id="gameMain" aria-label="Game map">
              <div id="canvasFrame">
                <GameCanvas />
                <GameInterface />
                <QuestTracker />
              </div>
            </main>
            <aside id="sidePanel" aria-label="Game controls">
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
