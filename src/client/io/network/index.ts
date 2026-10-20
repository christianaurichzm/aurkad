// WebSocket
export { initializeWebSocket, sendAction } from './wsManager';

// Sync
export { updateWebSocket } from './sync/gameStateSync';
export { updateChat, sendChatMessage } from './sync/chatSync';

// HTTP Base
export { httpClient, friendlyHttpError, httpError } from './http/httpClient';

// Authentication
export {
  changePassword,
  confirmPasswordReset,
  fetchAuthCapabilities,
  fetchEmail,
  fetchGameBrand,
  getGameBrand,
  type GameBrand,
  login,
  passwordMinLength,
  register,
  requestPasswordReset,
  setEmail,
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
  listModules,
  fetchDialogRefs,
  saveRecipe,
  deleteRecipe,
  fetchBehaviors,
} from './http/contentClient';

// Admin console
export {
  fetchCommands,
  runConsoleCommand,
  type CommandInfo,
} from './http/consoleClient';

// Admin dashboard session
export {
  adminLogin,
  adminSession,
  adminLogout,
  beginTwoFactor,
  confirmTwoFactor,
  fetchTwoFactor,
  removeTwoFactor,
  type AdminSession,
  type TwoFactorStatus,
} from './http/adminAuthClient';

// Administrative audit trail
export {
  fetchAuditLog,
  type AuditRecord,
  type AuditFilter,
} from './http/auditClient';

// Appearance (admin panel)
export {
  fetchTheme,
  saveTheme,
  uploadThemeImage,
  removeThemeImage,
} from './http/themeClient';

// Art (admin panel)
export { uploadSheet } from './http/assetsClient';

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
