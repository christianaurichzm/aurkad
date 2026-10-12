import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import {
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  TILE_SIZE,
  EQUIPMENT_SLOTS,
} from '../../../shared/constants.js';
import { gameConfig, respawnPosition } from '../../gameConfig.js';
import { findPlacement, onMap } from '../world/physicsService.js';
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
  type InventoryLike,
} from '../../../shared/types.js';
import { playerRepository } from '../../persistence/playerRepository.js';

import {
  getPlayerByName as lookupPlayerByName, // Runtime registry lookup, distinct from this file's own getPlayerById
  // (a database read), only to check disconnectPlayer is not racing a
  // second disconnect for the same player.
  getPlayerById as getRegisteredPlayer,
  registerPlayer,
  unregisterPlayer,
  getPlayer,
  updatePlayer,
} from '../../sim/world.js';
import { emit } from '../../engine/hooks.js';
import { addPlayerOnMap, removePlayerFromMap } from '../world/mapService.js';
import { getItemById } from '../content/itemService.js';
import { playersWsMap } from '../../net/connections.js';
import {
  broadcast,
  resetPlayerNetState,
  forgetReplicatedEntity,
} from '../../net/snapshot.js';
import {
  beginPlayerCommit,
  clearPlayerDirty,
  endPlayerCommit,
  waitForPlayerCommit,
  isPlayerCommitting,
  markPlayerDirty,
} from '../../persistence/dirtyPlayers.js';
import { lockInventory, unlockInventory } from '../economy/economyService.js';
import {
  acquirePresence,
  releasePresence,
} from '../../persistence/presence.js';
import { getBan, unbanPlayer } from './banService.js';
import { serverState } from '../serverState.js';
import { publishToInstances } from '../../persistence/instanceBus.js';
import { forgetEntrance, persistedLocation } from '../world/instanceService.js';
import {
  supportsTransactions,
  withTransaction,
} from '../../persistence/transactions.js';
import { clearAttackCooldown } from '../combat/attackCooldown.js';
import { clearDamageContributions } from '../combat/damage.js';
import { clearPressedKeys } from '../world/movementService.js';
import { logger } from '../../logger.js';
import { recordAdminAction } from '../auditService.js';
import { registerStrings, translate } from '../../engine/i18n.js';
import { revokePlayerSessions } from '../../net/transport.js';

export async function getPlayerForAuthentication(name: string) {
  return playerRepository.findForAuthentication(name);
}

export function notifySessionRevoked(username: string, epoch: number): void {
  revokePlayerSessions(username, epoch);
  publishToInstances('sessionRevoked', { username, epoch });
}

export async function getPlayerById(id: string): Promise<PlayerRecord | null> {
  return playerRepository.findById(id);
}

/** See `playerRepository.addStatsOffline`. */
export async function addStatsOffline(
  id: string,
  gains: Partial<Record<keyof PlayerServer, number>>,
): Promise<PlayerRecord | null> {
  return playerRepository.addStatsOffline(id, gains);
}

/** The generation a session must carry, or null when the account is gone. */
export async function authEpochOf(name: string): Promise<number | null> {
  return playerRepository.authEpochOf(name);
}

/**
 * Writes `name`'s access level through to the database at once. Sessions
 * read the level from the account on every request (see session.ts),
 * including ones on another instance or with no player in the world, so a
 * demotion left for the next snapshot would leave the rights in place.
 */
export async function saveAccess(name: string, access: Access): Promise<void> {
  await playerRepository.saveAccess(name, access);
}

export async function deletePlayer(id: string): Promise<void> {
  await playerRepository.deleteById(id);
}

export async function nameTaken(name: string): Promise<boolean> {
  return playerRepository.nameTaken(name);
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
    id: randomUUID(),
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

// Why a login or a returning socket is turned away. The socket has not said
// its language yet, so only the login reads these in anything but English.
registerStrings({
  pt: {
    'You are banned from this game.': 'Você está banido deste jogo.',
    'Reason: {reason}': 'Motivo: {reason}',
    'Until: {until}': 'Até: {until}',
    'Server is under maintenance. Please try again later.':
      'O servidor está em manutenção. Tente de novo mais tarde.',
    'Server is currently restricted to GMs only.':
      'O servidor está aberto só para GMs no momento.',
  },
});

// The access level each player in the world entered with or was given by
// setAccess. A script holds the live player, so `player.access = 2` there
// sticks, opens in-game commands and is saved, all without the audit trail
// seeing it. The save reports it there; it does not undo it, because a level
// the engine quietly reverts is a worse surprise than one it reports.
const auditedAccess = new WeakMap<PlayerServer, Access>();

/** The way to change a player's access, so the trail and the check agree. */
export function setAccess(player: PlayerServer, level: Access): void {
  player.access = level;
  auditedAccess.set(player, level);
}

function reportAccessDrift(player: PlayerServer): void {
  const audited = auditedAccess.get(player);
  if (audited === undefined || audited === player.access) return;
  auditedAccess.set(player, player.access);
  logger.warn('[audit] access changed outside setAccess', {
    player: player.name,
    from: audited,
    to: player.access,
  });
  recordAdminAction({
    action: 'access-drift',
    target: player.name,
    outcome: 'allowed',
    source: 'script',
    details: { from: audited, to: player.access },
  });
}

class PlayerWriteRefusedError extends Error {}
const playerWrites = new Map<string, Set<Promise<void>>>();

export async function waitForPlayerPersistence(id: string): Promise<void> {
  await Promise.allSettled([...(playerWrites.get(id) ?? [])]);
}

export function persistPlayerSessionState(
  player: PlayerServer,
  session?: ClientSession,
): Promise<void> {
  const writes = playerWrites.get(player.id) ?? new Set<Promise<void>>();
  playerWrites.set(player.id, writes);
  const pending = writePlayerSessionState(player, session).finally(() => {
    writes.delete(pending);
    if (!writes.size) playerWrites.delete(player.id);
  });
  writes.add(pending);
  return pending;
}

const writePlayerSessionState = async (
  player: PlayerServer,
  session?: ClientSession,
) => {
  reportAccessDrift(player);
  const written = await playerRepository.save(
    {
      ...player,
      // Not necessarily where they are standing: inside a dungeon the copy's
      // key means nothing once it closes, so what is written is the doorway.
      ...persistedLocation(player),
      direction: player.direction,
      action: player.action,
      health: player.health,
    },
    session,
  );
  // Explicitly false, not merely falsy: this ends with the player's socket
  // closed, and that is not a thing to do on a return value nobody promised.
  if (written === false) {
    presenceLost(player);
    throw new PlayerWriteRefusedError(`Player write refused: ${player.name}`);
  }
};

/**
 * The write was refused because another instance owns this account. Their
 * character is written by somebody else, so nothing this process changes
 * can be saved. Dropping the socket is the honest end: the fence refuses
 * the writes either way, and the alternative is an hour of play that
 * saves nothing at all.
 */
function presenceLost(player: PlayerServer): void {
  logger.error('[presence] write refused: the account is owned elsewhere', {
    player: player.name,
  });
  playersWsMap.get(player.name)?.close();
}

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
          await waitForPlayerCommit(player.id);
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
 *
 * Resolves to whether every player was written and never rejects, so a
 * caller may await durability or leave it floating.
 */
export async function persistPlayersNow(
  playersToSave: PlayerServer[],
): Promise<boolean> {
  if (mongoose.connection.readyState !== mongoose.ConnectionStates.connected)
    return false;
  if (playersToSave.some((player) => isPlayerCommitting(player.id)))
    return false;

  // Held for the whole call, not just the transaction: until the last await,
  // the write-behind sweep must not write one of these documents alone. A
  // single player needs no hold, as one document write is atomic.
  const held = playersToSave.length > 1 ? playersToSave.map((p) => p.id) : [];
  beginPlayerCommit(held);
  try {
    return await commitPlayers(playersToSave);
  } finally {
    endPlayerCommit(held);
  }
}

/**
 * Changes several players' inventories as one commit, confirmed only once
 * durable. `change` works on copies written together, and only a write that
 * landed becomes the live inventories, so a failed commit leaves nothing for
 * write-behind to save half of. The inventories stay locked from the first
 * await to the last, so nothing moves an item under the copies.
 *
 * False when a player is already mid-commit or listed twice, when `change`
 * returns false, or when the write did not land.
 */
export async function commitInventories(
  playersToCommit: PlayerServer[],
  change: (inventories: InventoryLike[]) => boolean,
): Promise<boolean> {
  const ids = playersToCommit.map((player) => player.id);
  if (
    mongoose.connection.readyState !== mongoose.ConnectionStates.connected ||
    new Set(ids).size !== ids.length ||
    ids.some(isPlayerCommitting)
  )
    return false;

  beginPlayerCommit(ids);
  for (const player of playersToCommit) lockInventory(player.inventory);
  try {
    // A snapshot that started before the hold must land first, or its stale
    // inventory would overwrite the commit.
    await Promise.all(ids.map(waitForPlayerPersistence));
    const inventories = playersToCommit.map((player) =>
      structuredClone(player.inventory),
    );
    if (!change(inventories)) return false;
    const committed = await commitPlayers(
      playersToCommit,
      playersToCommit.map((player, i) => ({
        ...player,
        inventory: inventories[i]!,
      })),
    );
    if (!committed) {
      // Without transactions one document may have landed. Memory still holds
      // the state before the change, so the next sweep writes it back.
      for (const id of ids) markPlayerDirty(id);
      return false;
    }
    playersToCommit.forEach((player, i) => {
      player.inventory.items = inventories[i]!.items;
      updatePlayer(player);
    });
    return true;
  } finally {
    for (const player of playersToCommit) unlockInventory(player.inventory);
    endPlayerCommit(ids);
  }
}

/** Writes `states[i]` for `playersToSave[i]`; states default to the players. */
async function commitPlayers(
  playersToSave: PlayerServer[],
  states = playersToSave,
): Promise<boolean> {
  if (playersToSave.length > 1 && supportsTransactions()) {
    let refused = false;
    const committed = await withTransaction(
      async (session) => {
        // Sequential: one session cannot run operations in parallel.
        for (const player of states) {
          try {
            await persistPlayerSessionState(player, session);
          } catch (err) {
            if (err instanceof PlayerWriteRefusedError) refused = true;
            throw err;
          }
        }
      },
      `economic commit: ${playersToSave.map((p) => p.name).join(', ')}`,
    );
    if (committed) return true;
    // No member of a refused pair may later save its half independently.
    if (refused) {
      await discardEconomicSessions(playersToSave);
      return false;
    }
    logger.error('[economy] atomic commit failed; write-behind retries', {
      players: playersToSave.map((p) => p.name),
    });
    return false;
  }

  const results = await Promise.allSettled(
    states.map((p) => persistPlayerSessionState(p)),
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      logger.error('[economy] immediate persist failed; write-behind retries', {
        player: playersToSave[i]?.name,
        err: result.reason,
      });
    }
  });
  return results.every((result) => result.status === 'fulfilled');
}

// Single funnel for all experience gain. Emits a mutable beforeXpGain hook
// (scripts scale it, as in VIP 2x or a weekend bonus), then applies it and
// processes level-ups. Clamps to a finite amount >= 0.
export const awardExperience = (
  player: PlayerServer,
  amount: number,
  source = 'script',
): number => {
  if (!gameConfig.leveling.enabled) return 0;
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
  // An id the catalogue no longer has (deleted in the editor, lost to a
  // restore, skipped at boot as malformed) is left out, never thrown on or
  // dropped: every stats payload, login and purchase crosses here, and the
  // entry itself survives, so recreating the item under that id returns it to
  // whoever held it.
  // The hidden entry still takes an inventory slot the player cannot
  // see or empty; strip holders in deleteItem if that starts to matter.
  const inventory: InventoryItemDetailed[] = [];
  for (const entry of player.inventory?.items ?? []) {
    const item = getItemById(entry.item);
    if (item) inventory.push({ item, quantity: entry.quantity });
  }

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
    inventoryCapacity: player.inventory?.maxCapacity ?? 0,
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
    nameTagColor: player.nameTagColor,
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
  if (s[20] !== player.nameTagColor) {
    s[20] = player.nameTagColor;
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

/** Whether `snapshot` last recorded `itemId` in the inventory or equipped. */
export function coldSnapshotHolds(
  snapshot: ColdSnapshot,
  itemId: number,
): boolean {
  for (let i = 0; i < snapshot.inventoryLength; i++) {
    if (snapshot.inventory[i * 2] === itemId) return true;
  }
  return snapshot.equipped.includes(itemId);
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
  // The socket may belong to another instance, since a ban is about an
  // account and not who holds it. The local half still runs, because they
  // might be here.
  publishToInstances('kick', { username, reason });
  return kickLocally(username, reason);
}

/** The half that touches only this process; a kick from the bus lands here. */
export async function kickLocally(
  username: string,
  reason: string,
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

function removePlayerSessionState(player: PlayerServer): void {
  clearPressedKeys(player.name);
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
    // Last, after the leave hook: the way out of a copy is what a write made
    // inside one puts in the document, and the next session starts from the
    // document, which holds it by then.
    forgetEntrance(player.id);
  }
}

async function discardEconomicSessions(
  playersToDiscard: PlayerServer[],
): Promise<void> {
  for (const player of playersToDiscard) {
    playersWsMap.get(player.name)?.close(1008, 'Economic commit refused');
    removePlayerSessionState(player);
    await releasePresence(player.id).catch((err) =>
      logger.error('[presence] release after refused commit failed', {
        player: player.name,
        err,
      }),
    );
  }
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

  await waitForPlayerCommit(player.id);
  try {
    await persistPlayerSessionState(player);
  } catch (err) {
    if (!(err instanceof PlayerWriteRefusedError)) throw err;
  }
  // After the last write of this session, never before it: the lease is what
  // makes that write land, and the instance the player moves to reads the
  // document as soon as it takes over.
  await releasePresence(player.id);
  removePlayerSessionState(player);
};

/**
 * Why this account may not enter the world at this moment, or null. Asked
 * at login and again when a socket comes back without one: a ban does not
 * end the session it was typed against, so a gate only the login form
 * crosses is one a redialling client walks past.
 */
export async function refuseEntry(
  record: PlayerRecord,
  language?: string,
): Promise<{ status: 403 | 503; message: string } | null> {
  const say = (text: string, params?: Record<string, string>) =>
    translate({ language }, text, params);
  const ban = await getBan(record.name);
  if (ban && (!ban.until || Date.now() < ban.until)) {
    return {
      status: 403,
      message: [
        say('You are banned from this game.'),
        ban.reason && say('Reason: {reason}', { reason: ban.reason }),
        ban.until &&
          say('Until: {until}', {
            until: new Date(ban.until).toLocaleString(language),
          }),
      ]
        .filter(Boolean)
        .join(' '),
    };
  } else if (ban) {
    await unbanPlayer(record.name);
  }

  if (serverState.mode === 'maintenance' && record.access < Access.ADMIN) {
    return {
      status: 503,
      message: say('Server is under maintenance. Please try again later.'),
    };
  }
  if (serverState.mode === 'gm_only' && record.access < Access.MOD) {
    return {
      status: 503,
      message: say('Server is currently restricted to GMs only.'),
    };
  }
  return null;
}

/** Puts a character loaded from its document into the world, on its map. */
export function enterWorld(player: PlayerServer) {
  // Callers spread the account record into the character, and the snapshot
  // loop `$set`s whatever the character carries back over the document: an
  // address or password kept from login would undo one changed while online.
  const account = player as Partial<PlayerRecord>;
  delete account.password;
  delete account.email;
  auditedAccess.set(player, player.access);
  // Saved on a map that has since been resized smaller, or arriving from an
  // instance that could not see this map's size for a border landing.
  player.position = onMap(player, player.mapId, player.position);
  // A slot worn since before equipping kept a record holds only the item's
  // id, and unequipping takes back what the definition gives, which is
  // nothing once the item is deleted. The current definition is the best
  // guess there is, so it is pinned while the item exists.
  for (const slot of EQUIPMENT_SLOTS) {
    const itemId = player.equipped?.[slot];
    if (!itemId || player.equippedEffects?.[slot]) continue;
    const effects = getItemById(itemId)?.effects;
    if (effects) {
      (player.equippedEffects ??= {})[slot] = effects.map((e) => ({ ...e }));
    }
  }
  if (!getRegisteredPlayer(player.id)) registerPlayer(player);
  const map = addPlayerOnMap(player.id);
  emit('playerJoin', { player });
  return map;
}

/**
 * Brings back a player whose session outlived their socket. The client
 * redials on its own after a blip, and a warp to another instance is the
 * same dial to another address; neither logs in again, and by then the
 * close has taken the character out of the world. The session proves who
 * they are (its generation is checked on the way in), so what is left of
 * the login is what follows the password: the same refusals, the lease,
 * then the world.
 *
 * Null once the player is in, or already was, the ordinary case of a
 * socket opened right after a login. Otherwise, why not.
 */
export async function resumePlayer(username: string): Promise<string | null> {
  if (getPlayerByName(username)) return null;

  const record = await getPlayerByNameFromDb(username);
  if (!record) return 'This account no longer exists.';

  const refused = await refuseEntry(record);
  if (refused) return refused.message;

  const presence = await acquirePresence(record.id, username);
  if (!presence.ok) {
    return 'This account is already logged in from another session.';
  }

  const { password: _pw, ...player } = record;
  enterWorld(player);
  return null;
}
