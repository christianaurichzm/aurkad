import { useState } from 'react';
import { ContentEditor } from '../components/ContentEditor/ContentEditor';
import { GameInterface } from '../components/GameInterface';
import { HudBar } from '../components/HudBar';
import { InventoryPanel } from '../components/Inventory/InventoryPanel';
import { Login } from './Login';
import { Register } from './Register';
import { ShopModal } from '../components/Shop/ShopModal';
import { TilesetEditor } from '../components/Tileset/TilesetEditor';
import { ModerationMenu } from '../components/ModerationMenu';
import { ChatPanel } from '../components/ChatPanel';
import { useGame } from '../context/GameContext';
import { AttributeDistributorModal } from '../components/AttributeDistributorModal';
import { GameCanvas } from '../components/GameCanvas';

function App() {
  const { isLoggedIn } = useGame();
  const [showRegister, setShowRegister] = useState(false);

  return isLoggedIn ? (
    <div id="ui">
      <GameCanvas />
      <GameInterface />
      <ShopModal />
      <HudBar />
      <ChatPanel />
      <AttributeDistributorModal />
      <ModerationMenu />
      <InventoryPanel />
      <TilesetEditor />
      <ContentEditor />
    </div>
  ) : showRegister ? (
    <Register onSwitch={() => setShowRegister(false)} />
  ) : (
    <Login onSwitch={() => setShowRegister(true)} />
  );
}

export default App;
