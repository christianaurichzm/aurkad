import { randomInt, randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import {
  SPRITE_WIDTH,
  SPRITE_HEIGHT,
  TILE_SIZE,
  EQUIPMENT_SLOTS,
} from '../../../shared/constants.js';
import { gameConfig, respawnPosition } from '../../gameConfig.js';
import { onMap } from '../world/physicsService.js';
import {
  PlayerServer,
  PlayerRecord,
  Access,
  Direction,
  CharacterAction,
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
import { addPlayerOnMap } from '../world/mapService.js';
import { getItemById } from '../content/itemService.js';
import { closeRevokedSocket, playersWsMap } from '../../net/connections.js';
import { resetPlayerNetState } from '../../net/viewerState.js';
import { forgetReplicatedEntity } from '../../net/entityReplication.js';
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
import { activeBan, banPlayer } from './banService.js';
import { serverState } from '../serverState.js';
import { publishToInstances } from '../../persistence/instanceBus.js';
import { forgetEntrance, persistedLocation } from '../world/instanceService.js';
import {
  supportsTransactions,
  withTransaction,
} from '../../persistence/transactions.js';
import { clearAttackCooldown } from '../combat/attackCooldown.js';
import { forgetChatAllowance } from '../comms/chatService.js';
import { clearDamageContributions } from '../combat/damage.js';
import { clearPressedKeys, warpToMap } from '../world/movementService.js';
import { logger } from '../../logger.js';
import { recordAdminAction } from '../auditService.js';
import { registerStrings, translate } from '../../engine/i18n.js';

export async function getPlayerForAuthentication(name: string) {
  return playerRepository.findForAuthentication(name);
}

/** The local half of a revocation; one from another instance lands here. */
export function revokeLocalSessions(username: string, epoch: number): void {
  if (closeRevokedSocket(username, epoch)) clearPressedKeys(username);
}

export function notifySessionRevoked(username: string, epoch: number): void {
  revokeLocalSessions(username, epoch);
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
  // The named account is how a deployment gets its first admin, not a grant
  // that stands while the variable is set: once one exists, the name
  // registered again (its account deleted, say) is an ordinary signup, and
  // whoever claims it first is not handed the server.
  const bootstrapAdminUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
  const isAdmin = bootstrapAdminUsername
    ? bootstrapAdminUsername === username &&
      !(await playerRepository.adminExists())
    : process.env.NODE_ENV !== 'production' &&
      !(await playerRepository.anyExists());

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

  // Sessions and reset links name the account by name and generation, and a
  // deleted account frees the name. The generation starts at random so
  // nothing the name's last holder left behind matches it, and never at 0,
  // which is what a session minted before the field existed reads as.
  await playerRepository.insert({
    ...newPlayer,
    password,
    authEpoch: randomInt(1, 2 ** 48),
  });
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
    'Your last session is still being saved. Try again in a moment.':
      'Sua última sessão ainda está sendo salva. Tente de novo em instantes.',
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
  // One at a time per player, in the order asked: two in flight can land in
  // either order, and a sweep that started before a logout would put the
  // older character back over its last save. Waiting also means the state is
  // read when the write starts, so a queued write carries the newest one.
  const pending = Promise.allSettled([...writes])
    .then(() => writePlayerSessionState(player, session))
    .finally(() => {
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
 * Final write of every connected player during shutdown, and of everyone
 * who left before their last write landed: a departure awaiting its retry
 * is in no player list, and its timer dies with the process.
 *
 * Not a sequential `for...await`: one rejected write would abort the loop
 * and drop every player after it, and N round trips in series outrun the
 * 10s force-exit timer. Both are silent, the player finding a stale
 * character at the next login. Concurrency is bounded, as thousands of
 * writes at once only queue behind the mongoose pool and invite timeouts.
 */
export async function persistPlayersOnShutdown(
  connected: PlayerServer[],
  concurrency = 32,
): Promise<{ saved: number; failed: number }> {
  const playersToSave = [...connected, ...unsavedDepartures.values()];
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
  const ctx = { player, amount, source, base: amount };
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

/**
 * Back to full health on the start map, which may be on another instance:
 * a warp like any other, handed off as a warp tile does. True when the
 * player left this process and there is nobody here to update.
 */
export const respawnPlayer = (player: PlayerServer): boolean => {
  player.health = player.maxHealth;
  return warpToMap(player, gameConfig.world.startMapId, respawnPosition);
};

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
  return true;
}

/**
 * Bans an account and ends everything it is signed in with. Returns the
 * account's own spelling of the name, or null when there is no account.
 *
 * A ban is checked where an account comes in (game login, a socket
 * resuming, the panel's login), and an open session came in before it.
 * Moving the generation on ends those at their next request on every
 * instance, as a password change does; otherwise a banned moderator keeps
 * the panel and console for as long as the cookie lasts.
 *
 * The name is matched ignoring case, as registration matches it, and the
 * ban is stored under the spelling every check reads; "alice" typed at the
 * console would otherwise store a ban that never refuses Alice.
 */
export async function banAccount(
  name: string,
  reason?: string,
  until?: number,
): Promise<string | null> {
  const username = await playerRepository.nameOf(name);
  if (!username) return null;

  // Stored before the sessions end, so a client redialling the moment it is
  // dropped is refused rather than let back in.
  await banPlayer(username, reason, until);
  const epoch = await playerRepository.endSessions(username);
  await kickPlayer(
    username,
    reason ? `You were banned: ${reason}` : 'You were banned from the game.',
  );
  if (epoch !== null) notifySessionRevoked(username, epoch);
  return username;
}

function removePlayerSessionState(player: PlayerServer): void {
  clearPressedKeys(player.name);
  clearPlayerDirty(player.id);
  clearAttackCooldown(player.id);
  forgetChatAllowance(player.name);
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

/**
 * Departures under way, by player id. A logout or a kick ends the character
 * and closes the socket, whose close asks for the same departure again. Run
 * twice, the second would write and let go of the lease after the first, by
 * when a new session may hold both; so it waits on the first instead, and
 * refuseEntry keeps a new session out until it is done.
 */
const departures = new Map<string, Promise<void>>();

export const disconnectPlayer = async (username?: string) => {
  // Cleared unconditionally, even when the player isn't found below: stale
  // held-key state for a name nobody answers to would otherwise sit in
  // movementService's map until something else happens to overwrite it.
  if (username) clearPressedKeys(username);

  const player = username ? getPlayerByName(username) : undefined;
  if (!player) {
    return;
  }

  let departure = departures.get(player.id);
  if (!departure) {
    departure = depart(player).finally(() => departures.delete(player.id));
    departures.set(player.id, departure);
  }
  await departure;
};

/** Whether this character's last write and release are under way. */
export function isDeparting(id: string): boolean {
  return departures.has(id);
}

async function depart(player: PlayerServer): Promise<void> {
  await waitForPlayerCommit(player.id);
  try {
    await persistPlayerSessionState(player);
  } catch (err) {
    if (!(err instanceof PlayerWriteRefusedError)) {
      logger.error('[presence] last write failed; retrying out of the world', {
        player: player.name,
        err,
      });
      // Taken while the way out of a dungeon copy is still known: leaving the
      // world forgets it, and the retry would write the respawn point instead.
      const location = persistedLocation(player);
      removePlayerSessionState(player);
      retryDeparture(Object.assign(player, location));
      return;
    }
  }
  // After the last write of this session, never before: the lease makes that
  // write land, and the next instance reads the document as soon as it takes
  // over. A failed release still leaves the world, since the lease is out of
  // `held` and a character kept here would be saved with no fence, over
  // whoever takes the account when the lease expires.
  await releasePresence(player.id).catch((err) =>
    logger.error('[presence] release after logout failed', {
      player: player.name,
      err,
    }),
  );
  removePlayerSessionState(player);
}

/**
 * Characters that left the world before their last write landed. Out of
 * the simulation, as nobody is at the keyboard to defend them, but kept:
 * memory holds the only copy of the progress since the last snapshot. The
 * lease stays held and renewed until the write lands, so no instance loads
 * the stale document, and refuseEntry turns this one's own login away.
 */
const unsavedDepartures = new Map<string, PlayerServer>();
const DEPARTURE_RETRY_MS = 5_000;

function retryDeparture(player: PlayerServer): void {
  unsavedDepartures.set(player.id, player);
  setTimeout(() => void settleDeparture(player), DEPARTURE_RETRY_MS).unref();
}

async function settleDeparture(player: PlayerServer): Promise<void> {
  try {
    await persistPlayerSessionState(player);
  } catch (err) {
    if (!(err instanceof PlayerWriteRefusedError)) {
      retryDeparture(player);
      return;
    }
  }
  unsavedDepartures.delete(player.id);
  await releasePresence(player.id).catch(() => undefined);
}

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
  if (unsavedDepartures.has(record.id) || departures.has(record.id)) {
    return {
      status: 503,
      message: say(
        'Your last session is still being saved. Try again in a moment.',
      ),
    };
  }
  const ban = await activeBan(record.name);
  if (ban) {
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

  // Read again under the lease: the instance that let go of it wrote its last
  // save on the way out, and that can land after the read above. Entering
  // with the older copy brings back whatever that session gave away.
  const current = await getPlayerByNameFromDb(username);
  if (!current) {
    await releasePresence(record.id);
    return 'This account no longer exists.';
  }
  const { password: _pw, ...player } = current;
  enterWorld(player);
  return null;
}
