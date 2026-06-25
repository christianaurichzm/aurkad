// WebSocket
export { WS_URL, initializeWebSocket, sendAction } from './wsManager';

// Sync
export { updateWebSocket } from './sync/gameStateSync';
export { updateChat, sendChatMessage } from './sync/chatSync';

// HTTP Base
export { httpClient, API_URL, REST_PROTO } from './http/httpClient';

// Authentication
export { login, register, silentAction } from './http/authClient';

// Editors
export {
  openMapEditor,
  openModEditor,
  openContentEditor,
  saveMap,
  resizeMap,
  fetchMaps,
  fetchMap,
  updateMap,
  createMap,
  modMoveMap,
  type SaveMapResponse,
} from './http/editorClient';

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
  createShop,
  updateShop,
  deleteShop,
  changeSprite,
  fetchSpells,
  createSpell,
  updateSpell,
  deleteSpell,
  fetchArrows,
  createArrow,
  updateArrow,
  deleteArrow,
} from './http/contentClient';

// Moderation
export {
  modKick,
  modBan,
  modBring,
  modGoto,
  modSetAccess,
  modSetSprite,
  modSetMyAccess,
} from './http/modClient';

// Shop
export { buyShopItem } from './http/shopClient';

// Player
export { assignPointsPlayer, fetchOnlinePlayers } from './http/playerClient';

// File Loader
export { loadImageFromBin } from './fileLoader';
