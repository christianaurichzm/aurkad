// WebSocket
export { WS_URL, initializeWebSocket, sendAction } from './network/wsManager';

// Sync
export { updateWebSocket } from './network/sync/gameStateSync';
export { updateChat, sendChatMessage } from './network/sync/chatSync';

// HTTP Base
export { httpClient, API_URL, REST_PROTO } from './network/http/httpClient';

// Authentication
export { login, register, silentAction } from './network/http/authClient';

// Editors
export {
  openMapEditor,
  openModEditor,
  openContentEditor,
  saveMap,
  fetchMaps,
  fetchMap,
  updateMap,
  createMap,
  modMoveMap,
} from './network/http/editorClient';

// Content (NPCs, Items, Shops)
export {
  fetchNpcs,
  createNpc,
  updateNpc,
  deleteNpc,
  fetchItems,
  createItem,
  updateItem,
  deleteItem,
  fetchShops,
  fetchShop,
  changeSprite,
} from './network/http/contentClient';

// Moderation
export {
  modKick,
  modBan,
  modBring,
  modGoto,
  modSetAccess,
  modSetSprite,
  modSetMyAccess,
} from './network/http/modClient';

// Shop
export { buyShopItem } from './network/http/shopClient';

// Player
export { assignPointsPlayer } from './network/http/playerClient';

// File Loader
export { loadImageFromBin } from './network/fileLoader';
