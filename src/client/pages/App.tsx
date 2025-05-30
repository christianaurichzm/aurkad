import { ContentEditor } from '../components/ContentEditor/ContentEditor';
import { GameInterface } from '../components/GameInterface';
import { HudBar } from '../components/HudBar';
import { InventoryPanel } from '../components/Inventory/InventoryPanel';
import { Login } from './Login';
import { ShopModal } from '../components/Shop/ShopModal';
import { TilesetEditor } from '../components/Tileset/TilesetEditor';
import { ModerationMenu } from '../components/ModerationMenu';
import { ChatPanel } from '../components/ChatPanel';
import { useGame } from '../context/GameContext';
import { AttributeDistributorModal } from '../components/AttributeDistributorModal';

function App() {
  const { isLoggedIn } = useGame();

  return (
    <>
      {isLoggedIn ? (
        <>
          <GameInterface />
          <ShopModal />
          <HudBar />
          <ChatPanel />
          <AttributeDistributorModal />
          <ModerationMenu />
          <InventoryPanel />
          <TilesetEditor />
          <ContentEditor />
        </>
      ) : (
        <Login />
      )}
    </>
  );
}

export default App;
