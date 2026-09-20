import { gameConfig } from '../server/gameConfig.js';
import { loadModules } from '../server/engine/modules/moduleLoader.js';

/**
 * Loads the real modules with the named ones forced on. `loadModules`
 * filters by game.json, the creator's file, and a game shipping a module
 * off would turn that module's tests red. Whatever else the config enables
 * still loads, so a test leaning on a neighbouring module keeps working.
 */
export function loadModulesForTest(...ids: string[]): void {
  for (const id of ids) {
    gameConfig.modules[id] = { ...gameConfig.modules[id], enabled: true };
  }
  loadModules();
}
