// WebSocket
export { WS_URL, initializeWebSocket, sendAction } from './wsManager';

// Sync
export { updateWebSocket } from './sync/gameStateSync';
export { updateChat, sendChatMessage } from './sync/chatSync';

// HTTP Base
export {
  httpClient,
  friendlyHttpError,
  httpError,
  API_URL,
  REST_PROTO,
} from './http/httpClient';

// Authentication
export {
  changePassword,
  confirmPasswordReset,
  fetchAuthCapabilities,
  login,
  register,
  requestPasswordReset,
  silentAction,
} from './http/authClient';

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
  listLootTables,
  saveLootTable,
  deleteLootTable,
  listDialogs,
  saveDialog,
  deleteDialog,
  listQuests,
  saveQuest,
  deleteQuest,
  listRecipes,
  saveRecipe,
  deleteRecipe,
  fetchBehaviors,
} from './http/contentClient';

// Admin console
export {
  openConsole,
  fetchCommands,
  runConsoleCommand,
  type CommandInfo,
} from './http/consoleClient';

// Admin dashboard session
export {
  adminLogin,
  adminSession,
  adminLogout,
  type AdminSession,
} from './http/adminAuthClient';

// Administrative audit trail
export {
  fetchAuditLog,
  type AuditRecord,
  type AuditFilter,
} from './http/auditClient';

// Scripts (Monaco editor)
export {
  listScripts,
  getScriptTypes,
  getScript,
  saveScript,
  createScript,
  deleteScript,
  getScriptErrors,
  type ScriptFileInfo,
  type ScriptTypeDefs,
  type ScriptError,
} from './http/scriptsClient';

// Moderation
export {
  modWarp,
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
