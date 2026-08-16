import mongoose, { type ClientSession } from 'mongoose';
import {
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  TILE_SIZE,
  EQUIPMENT_SLOTS,
} from '../../../shared/constants.js';
import { gameConfig, respawnPosition } from '../../gameConfig.js';
import { findPlacement } from '../world/physicsService.js';
import {
  PlayerServer,
  PlayerRecord,
  Access,
  Direction,
  CharacterAction,
  EquippedItemsDetailed,
  InventoryItemDetailed,
  Player,
  PlayerCold,
  PlayerHot,
} from '../../../shared/types.js';
import { playerRepository } from '../../persistence/playerRepository.js';

import { getPlayer, updatePlayer } from '../world/gameData.js';
import {
  getPlayerByName as lookupPlayerByName,
  // Runtime registry lookup, distinct from this file's own getPlayerById
  // (a database read), only to check disconnectPlayer is not racing a
  // second disconnect for the same player.
  getPlayerById as getRegisteredPlayer,
  unregisterPlayer,
} from '../../sim/world.js';
import { emit } from '../../engine/hooks.js';
import { addPlayerOnMap, removePlayerFromMap } from '../world/mapService.js';
import { getItemById } from '../economy/inventoryService.js';
import {
  broadcast,
  playersWsMap,
  resetPlayerNetState,
  forgetReplicatedEntity,
} from '../../net/index.js';
import {
  beginPlayerCommit,
  clearPlayerDirty,
  endPlayerCommit,
} from '../../persistence/dirtyPlayers.js';
import {
  supportsTransactions,
  withTransaction,
} from '../../persistence/transactions.js';
import { clearAttackCooldown } from '../combat/attackCooldown.js';
import { clearDamageContributions } from '../combat/damage.js';
import { clearPressedKeys } from '../world/movementService.js';
import { logger } from '../../logger.js';

export async function getPlayerById(id: string): Promise<PlayerRecord | null> {
  return playerRepository.findById(id);
}

export async function createOrUpdatePlayer(
  player: PlayerServer,
  session?: ClientSession,
): Promise<void> {
  await playerRepository.save(player, session);
}

export async function deletePlayer(id: string): Promise<void> {
  await playerRepository.deleteById(id);
}

export async function listPlayers(): Promise<PlayerRecord[]> {
  return playerRepository.list();
}

export const createPlayer = async (
  username: string,
  password: string,
): Promise<PlayerServer> => {
  const bootstrapAdminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const isAdmin =
    bootstrapAdminUsername === username ||
    (!bootstrapAdminUsername &&
      process.env.NODE_ENV !== 'production' &&
      !(await playerRepository.anyExists()));

  const {
    startingAttack,
    startingStrength,
    startingDefense,
    startingAgility,
    startingMaxHealth,
    startingSpeed,
    startingInventoryCapacity,
  } = gameConfig.player;
  const { baseXp } = gameConfig.leveling;

  const newPlayer: PlayerServer = {
    id: Math.random().toString(36).substring(2, 9),
    name: username,
    position: respawnPosition,
    width: SPRITE_WIDTH,
    height: SPRITE_HEIGHT,
    speed: startingSpeed,
    kind: 'player',
    attack: startingAttack,
    strength: startingStrength,
    defense: startingDefense,
    agility: startingAgility,
    vitality: 0,
    unspentPoints: 0,
    level: 1,
    experience: 0,
    experienceToNextLevel: baseXp,
    attackRange: TILE_SIZE,
    mapId: gameConfig.world.startMapId,
    sprite: 0,
    maxHealth: startingMaxHealth,
    health: startingMaxHealth,
    inventory: {
      items: [],
      maxCapacity: startingInventoryCapacity,
    },
    equipped: {},
    access: isAdmin ? Access.ADMIN : Access.USER,
    direction: Direction.Down,
    action: CharacterAction.Idle,
    data: {},
  };

  await playerRepository.insert({ ...newPlayer, password });
  return newPlayer;
};

export const persistPlayerSessionState = async (
  player: PlayerServer,
  session?: ClientSession,
) => {
  await createOrUpdatePlayer(
    {
      ...player,
      position: player.position,
      direction: player.direction,
      action: player.action,
      mapId: player.mapId,
      health: player.health,
    },
    session,
  );
};

/**
 * Final write of every connected player during shutdown.
 *
 * Not a sequential `for...await`: one rejected write would abort the loop
 * and drop every player after it, and N round trips in series outrun the
 * 10s force-exit timer. Both are silent, the player finding a stale
 * character at the next login. Concurrency is bounded, as thousands of
 * writes at once only queue behind the mongoose pool and invite timeouts.
 */
export async function persistPlayersOnShutdown(
  playersToSave: PlayerServer[],
  concurrency = 32,
): Promise<{ saved: number; failed: number }> {
  let cursor = 0;
  let failed = 0;

  const workers = Array.from(
    { length: Math.min(concurrency, playersToSave.length) },
    async () => {
      while (cursor < playersToSave.length) {
        const player = playersToSave[cursor++]!;
        try {
          await persistPlayerSessionState(player);
        } catch (err) {
          failed++;
          logger.error('[Shutdown] failed to persist player', {
            player: player.name,
            err,
          });
        }
      }
    },
  );

  await Promise.all(workers);
  return { saved: playersToSave.length - failed, failed };
}

/**
 * Immediate persistence for economic commits (bank, trade, shop, crafting),
 * since write-behind alone leaves a crash window where a confirmed transfer
 * reverts. A trade moves an item between two documents, and a crash between
 * the writes duplicates or destroys it, so with transactions both go in
 * one; a standalone Mongo writes them one after the other.
 *
 * A failed transaction is not retried as separate writes: an abort wrote
 * nothing, and writing one half afterwards is the inconsistency it exists
 * to prevent. Both paths leave the dirty flag set by `updatePlayer`, so
 * write-behind is the retry.
 */
export async function persistPlayersNow(
  playersToSave: PlayerServer[],
): Promise<void> {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected)
    return;

  // Held for the whole call, not just the transaction: until the last await,
  // the write-behind sweep must not write one of these documents alone. A
  // single player needs no hold, as one document write is atomic.
  const held = playersToSave.length > 1 ? playersToSave.map((p) => p.id) : [];
  beginPlayerCommit(held);
  try {
    await commitPlayers(playersToSave);
  } finally {
    endPlayerCommit(held);
  }
}

async function commitPlayers(playersToSave: PlayerServer[]): Promise<void> {
  if (playersToSave.length > 1 && supportsTransactions()) {
    const committed = await withTransaction(
      async (session) => {
        // Sequential: one session cannot run operations in parallel.
        for (const player of playersToSave) {
          await persistPlayerSessionState(player, session);
        }
      },
      `economic commit: ${playersToSave.map((p) => p.name).join(', ')}`,
    );
    if (committed) return;
    logger.error('[economy] atomic commit failed; write-behind retries', {
      players: playersToSave.map((p) => p.name),
    });
    return;
  }

  const results = await Promise.allSettled(
    playersToSave.map((p) => persistPlayerSessionState(p)),
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error('[economy] immediate persist failed; write-behind retries', {
        player: playersToSave[i]?.name,
        err: result.reason,
      });
    }
  });
}

// Single funnel for all experience gain. Emits a mutable beforeXpGain hook
// (scripts scale it, as in VIP 2x or a weekend bonus), then applies it and
// processes level-ups. Clamps to a finite amount >= 0.
export const awardExperience = (
  player: PlayerServer,
  amount: number,
  source = 'script',
): number => {
  const ctx = { player, amount, source };
  emit('beforeXpGain', ctx);
  const gained =
    Number.isFinite(ctx.amount) && ctx.amount > 0 ? Math.floor(ctx.amount) : 0;
  if (gained <= 0) return 0;
  player.experience += gained;
  levelUpPlayer(player);
  return gained;
};

export const levelUpPlayer = (player: PlayerServer): void => {
  const { baseXp, xpGrowthRate, pointsPerLevel } = gameConfig.leveling;

  while (player.experience >= player.experienceToNextLevel) {
    player.experience -= player.experienceToNextLevel;
    player.level++;
    player.experienceToNextLevel = Math.floor(
      baseXp * Math.pow(xpGrowthRate, player.level - 1),
    );
    player.unspentPoints += pointsPerLevel;
    emit('playerLevelUp', { player, level: player.level });
  }
};

export const handlePlayerUpdates = (player: PlayerServer): void => {
  const existingPlayer = getPlayer(player.id);
  if (existingPlayer) {
    // Mutate the registered object in place instead of swapping in a merged
    // copy. Swapping detaches any reference held elsewhere (in-flight combat, a
    // script, an async op mid-await), silently losing that reference's later
    // mutations. Object.assign keeps the same identity across the registry.
    if (existingPlayer !== player) Object.assign(existingPlayer, player);
    updatePlayer(existingPlayer);
  }
};

export const respawnPlayer = (player: PlayerServer): void => {
  player.health = player.maxHealth;
  removePlayerFromMap(player.id);
  player.mapId = gameConfig.world.startMapId;
  // Everyone respawns on the same tile, so without placement a wipe would
  // stack the whole party on one square until they walked off it.
  player.position = findPlacement(
    player,
    gameConfig.world.startMapId,
    respawnPosition,
  );
  addPlayerOnMap(player.id);
};

export function toPlayerHot(player: PlayerServer): PlayerHot {
  return {
    id: player.id,
    position: { ...player.position },
    targetPosition: player.targetPosition
      ? { ...player.targetPosition }
      : undefined,
    moving: player.moving,
    moveTick: player.moveTick,
    moveDurationTicks: player.moveDurationTicks,
    direction: player.direction,
    action: player.action,
    health: player.health,
    lastProcessedSeq: player.lastProcessedSeq,
  };
}

export function toPlayerCold(player: PlayerServer): PlayerCold {
  const inventory: InventoryItemDetailed[] = (
    player.inventory?.items ?? []
  ).map((entry) => {
    const item = getItemById(entry.item);

    if (!item) throw new Error(`Item ${entry.item} not found`);
    return { item, quantity: entry.quantity };
  });

  const equippedSource = player.equipped ?? {};
  const equipped: EquippedItemsDetailed = {};
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = equippedSource[slot];
    if (itemId) {
      const item = getItemById(itemId);
      if (item) equipped[slot] = item;
    }
  }

  return {
    id: player.id,
    name: player.name,
    sprite: player.sprite,
    width: player.width,
    height: player.height,
    maxHealth: player.maxHealth,
    attack: player.attack,
    attackRange: player.attackRange,
    level: player.level,
    experience: player.experience,
    experienceToNextLevel: player.experienceToNextLevel,
    inventory,
    equipped,
    access: player.access,
    strength: player.strength,
    defense: player.defense,
    agility: player.agility,
    vitality: player.vitality,
    unspentPoints: player.unspentPoints,
    speed: player.speed,
    mapId: player.mapId,
    nameColor: player.nameColor,
    nameTag: player.nameTag,
    kind: 'player',
  };
}

/**
 * What a viewer was last told about a player's cold state, compared field
 * by field each tick rather than as a `JSON.stringify` of the same fields,
 * which would cost CPU and a garbage string per idle player per tick. The
 * comparison allocates nothing on the unchanged path.
 *
 * Not a dirty flag: every site that mutates a cold field would have to set
 * it, and several bypass `updatePlayer` (warps, mod routes, the REPL,
 * level-ups), so one missed site shows stale stats. Comparing the values
 * cannot drift from the mutation sites. Loose parallel arrays rather than a
 * `PlayerCold`, since building the payload every tick is the cost avoided.
 */
export interface ColdSnapshot {
  scalars: unknown[];
  inventory: number[];
  inventoryLength: number;
  inventoryCapacity: number | undefined;
  equipped: Array<number | undefined>;
}

export function createColdSnapshot(): ColdSnapshot {
  return {
    // Not pre-filled: `undefined` in every slot means the first
    // comparison always reports a change, so a new viewer gets a full payload.
    scalars: [],
    inventory: [],
    inventoryLength: -1,
    inventoryCapacity: undefined,
    equipped: [],
  };
}

/**
 * Syncs `snapshot` to the player's current cold state, returning whether
 * anything differed. Every field is compared and written in one pass with
 * no early return, so a caller ignoring the result still leaves it
 * consistent. The field list must match `toPlayerCold`: a field sent but not
 * compared here stops updating on the client.
 */
export function updateColdSnapshot(
  player: PlayerServer,
  snapshot: ColdSnapshot,
): boolean {
  let changed = false;

  const s = snapshot.scalars;
  if (s[0] !== player.name) {
    s[0] = player.name;
    changed = true;
  }
  if (s[1] !== player.sprite) {
    s[1] = player.sprite;
    changed = true;
  }
  if (s[2] !== player.width) {
    s[2] = player.width;
    changed = true;
  }
  if (s[3] !== player.height) {
    s[3] = player.height;
    changed = true;
  }
  if (s[4] !== player.maxHealth) {
    s[4] = player.maxHealth;
    changed = true;
  }
  if (s[5] !== player.attack) {
    s[5] = player.attack;
    changed = true;
  }
  if (s[6] !== player.attackRange) {
    s[6] = player.attackRange;
    changed = true;
  }
  if (s[7] !== player.level) {
    s[7] = player.level;
    changed = true;
  }
  if (s[8] !== player.experience) {
    s[8] = player.experience;
    changed = true;
  }
  if (s[9] !== player.experienceToNextLevel) {
    s[9] = player.experienceToNextLevel;
    changed = true;
  }
  if (s[10] !== player.access) {
    s[10] = player.access;
    changed = true;
  }
  if (s[11] !== player.strength) {
    s[11] = player.strength;
    changed = true;
  }
  if (s[12] !== player.defense) {
    s[12] = player.defense;
    changed = true;
  }
  if (s[13] !== player.agility) {
    s[13] = player.agility;
    changed = true;
  }
  if (s[14] !== player.vitality) {
    s[14] = player.vitality;
    changed = true;
  }
  if (s[15] !== player.unspentPoints) {
    s[15] = player.unspentPoints;
    changed = true;
  }
  if (s[16] !== player.speed) {
    s[16] = player.speed;
    changed = true;
  }
  if (s[17] !== player.mapId) {
    s[17] = player.mapId;
    changed = true;
  }
  if (s[18] !== player.nameColor) {
    s[18] = player.nameColor;
    changed = true;
  }
  if (s[19] !== player.nameTag) {
    s[19] = player.nameTag;
    changed = true;
  }

  const items = player.inventory?.items;
  const count = items?.length ?? 0;
  if (snapshot.inventoryLength !== count) {
    snapshot.inventoryLength = count;
    changed = true;
  }
  const capacity = player.inventory?.maxCapacity;
  if (snapshot.inventoryCapacity !== capacity) {
    snapshot.inventoryCapacity = capacity;
    changed = true;
  }
  // Flattened into id/quantity pairs so the common case reads one array of
  // numbers. Entries past `count` are left stale: a shrink already reported a
  // change through the length, and they are overwritten before being read.
  const inv = snapshot.inventory;
  for (let i = 0; i < count; i++) {
    const entry = items[i]!;
    const at = i * 2;
    if (inv[at] !== entry.item) {
      inv[at] = entry.item;
      changed = true;
    }
    if (inv[at + 1] !== entry.quantity) {
      inv[at + 1] = entry.quantity;
      changed = true;
    }
  }

  const equippedSource = player.equipped;
  const eq = snapshot.equipped;
  for (let i = 0; i < EQUIPMENT_SLOTS.length; i++) {
    const value = equippedSource?.[EQUIPMENT_SLOTS[i]!];
    if (eq[i] !== value) {
      eq[i] = value;
      changed = true;
    }
  }

  return changed;
}

export function enrichPlayer(player: PlayerServer): Player {
  return {
    ...toPlayerCold(player),
    ...toPlayerHot(player),
  };
}

export const getPlayerByName = (username: string): PlayerServer | undefined =>
  lookupPlayerByName(username);

export async function getPlayerByNameFromDb(
  name: string,
): Promise<PlayerRecord | null> {
  return playerRepository.findByName(name);
}

export const changeSprite = (spriteId: number, username: string) => {
  const newPlayer: PlayerServer = {
    ...getPlayerByName(username)!,
    sprite: spriteId,
  };
  handlePlayerUpdates(newPlayer);
  broadcast();
};

export async function kickPlayer(
  username: string,
  reason = 'You were kicked from the server.',
): Promise<boolean> {
  const ws = playersWsMap.get(username);
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify({ type: 'kick', message: reason }));
    ws.close();
  }
  playersWsMap.delete(username);
  await disconnectPlayer(username);
  broadcast();
  return true;
}

export const disconnectPlayer = async (username?: string) => {
  // Cleared unconditionally, even when the player isn't found below: stale
  // held-key state for a name nobody answers to would otherwise sit in
  // movementService's map until something else happens to overwrite it.
  if (username) clearPressedKeys(username);

  const player = username ? getPlayerByName(username) : undefined;
  if (!player) {
    return;
  }

  await persistPlayerSessionState(player);
  clearPlayerDirty(player.id);
  clearAttackCooldown(player.id);
  if (getRegisteredPlayer(player.id)) {
    emit('playerLeave', { player });
    unregisterPlayer(player.id);
    resetPlayerNetState(player.name);
    // Per-viewer caches are keyed by viewer name and cleared above; the
    // entity's own diff baseline is keyed by id and lives elsewhere.
    forgetReplicatedEntity(player.id);
    // Logging out mid-fight is the one way a player leaves without dying, and
    // the ledger is keyed by the victim.
    clearDamageContributions(player.id);
  }
};
