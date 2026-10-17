import { WebSocket } from 'ws';
import { TILE_SIZE } from '../../shared/constants.js';
import {
  Access,
  type ChatMessagePayload,
  type PlayerServer,
  type Position,
} from '../../shared/types.js';
import {
  registerCommand,
  type CommandContext,
  type CommandStyle,
} from '../engine/commands.js';
import {
  banPlayer,
  unbanPlayer,
  getBan,
} from '../services/player/banService.js';
import { broadcast } from '../net/snapshot.js';
import { playersWsMap } from '../net/connections.js';
import { warpToMap } from '../services/world/movementService.js';
import { getAllPlayers, getMap, updatePlayer } from '../sim/world.js';
import { isMuted, serverState } from '../services/serverState.js';
import {
  createResetToken,
  resetLink,
} from '../services/player/passwordService.js';
import {
  disableTwoFactor,
  twoFactorStatus,
} from '../services/player/twoFactorService.js';
import { activityOf, forgetPlayer } from '../services/analyticsService.js';
import { publishToInstances } from '../persistence/instanceBus.js';
import { leaseHolderOf } from '../persistence/presence.js';
import { lookupInstanceUrl } from '../persistence/instanceRegistry.js';
import {
  deletePlayer,
  disconnectPlayer,
  getPlayerByName,
  getPlayerByNameFromDb,
  kickPlayer,
  levelUpPlayer,
} from '../services/player/playerService.js';
import { killPlayer } from '../services/combat/index.js';
import {
  cancelDelivery,
  listDeliveries,
} from '../services/economy/deliveryService.js';

// Commands whose subject is a player. Registered once at boot, so the
// terminal, the web console and in-game chat share one implementation and
// the dispatcher that writes the audit trail. Access levels gate chat and
// the console (not the terminal) and match the /mod route for the same act.

const POINTS_PER_LEVEL = 5;

const accessLabel: Record<Access, string> = {
  [Access.USER]: 'USER',
  [Access.MOD]: 'MOD',
  [Access.ADMIN]: 'ADMIN',
};

function tile(position: Position): Position {
  return {
    x: Math.round(position.x / TILE_SIZE),
    y: Math.round(position.y / TILE_SIZE),
  };
}

function posFromTile(x: number, y: number): Position {
  return { x: x * TILE_SIZE, y: y * TILE_SIZE };
}

function parsePositiveInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function parseNonNegativeInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function onlinePlayers(): PlayerServer[] {
  return getAllPlayers().sort((a, b) => a.name.localeCompare(b.name));
}

/** The named player, or null with the refusal already replied. */
function requireOnline(
  name: string | undefined,
  ctx: Pick<CommandContext, 'reply' | 'style'>,
): PlayerServer | null {
  const player = name ? getPlayerByName(name) : undefined;
  if (!player) {
    ctx.reply(ctx.style.error(`Player not online: ${name ?? '<missing>'}`));
    return null;
  }
  return player;
}

function saveAndBroadcast(players: PlayerServer[]): void {
  const unique = new Map(players.map((player) => [player.id, player]));
  for (const player of unique.values()) updatePlayer(player);
  broadcast();
}

/** A line only the named player sees, marked as coming from an operator. */
function sendPrivateMessage(username: string, message: string): boolean {
  const ws = playersWsMap.get(username);
  if (ws?.readyState !== WebSocket.OPEN) return false;

  const payload: ChatMessagePayload = {
    type: 'chat',
    scope: 'player',
    username: '[ADMIN]',
    message,
  };
  ws.send(JSON.stringify(payload));
  return true;
}

type TeleportDestination =
  | { ok: true; mapId: string; position: Position; label: string }
  | { ok: false; error: string };

/** Local, or another instance's under sharding. */
const mapIsServed = (mapId: string): boolean =>
  !!getMap(mapId) || !!lookupInstanceUrl(mapId);

/**
 * `<targetUser>` or `<mapId> <tileX> <tileY>`. Under sharding either can be
 * on another process; the destination is still a map id and a tile, and the
 * redirect in `warpToMap` carries the player across.
 */
async function resolveDestination(
  args: string[],
): Promise<TeleportDestination> {
  if (args.length === 1) {
    const name = args[0] ?? '';
    const target = getPlayerByName(name);
    if (target) {
      const t = tile(target.position);
      return {
        ok: true,
        mapId: target.mapId,
        position: { ...target.position },
        label: `${target.name} on map ${target.mapId} tile (${t.x},${t.y})`,
      };
    }

    // Held elsewhere: the document has their spot as of the last write-behind
    // flush, which may be a map they have since left, and the label says so.
    // The lease is asked first, so an offline name still reads as offline.
    const record = (await leaseHolderOf(name))
      ? await getPlayerByNameFromDb(name)
      : null;
    if (record?.mapId && record.position) {
      // The lease outlives the registry entry of an instance that died, and
      // sending somebody to a map no process is serving would move nobody
      // while reading as done.
      if (!mapIsServed(record.mapId)) {
        return {
          ok: false,
          error: `${record.name} is on map ${record.mapId}, which no instance is serving.`,
        };
      }

      const t = tile(record.position);
      return {
        ok: true,
        mapId: record.mapId,
        position: { ...record.position },
        label: `${record.name}, last seen on map ${record.mapId} tile (${t.x},${t.y})`,
      };
    }

    return { ok: false, error: `Target player not online: ${name}` };
  }

  if (args.length === 3) {
    const [mapId, xArg, yArg] = args;
    if (!mapId || !mapIsServed(mapId)) {
      return { ok: false, error: `Map not found: ${mapId ?? '<missing>'}` };
    }

    const x = parseNonNegativeInt(xArg);
    const y = parseNonNegativeInt(yArg);
    if (x === null || y === null) {
      return {
        ok: false,
        error: 'Coordinates must be non-negative tile integers.',
      };
    }

    return {
      ok: true,
      mapId,
      position: posFromTile(x, y),
      label: `map ${mapId} tile (${x},${y})`,
    };
  }

  return {
    ok: false,
    error: 'Expected <targetUser> or <mapId> <tileX> <tileY>.',
  };
}

function describePlayer(
  player: PlayerServer,
  style: CommandStyle,
  banned: boolean,
): string[] {
  const map = getMap(player.mapId);
  const t = tile(player.position);
  const ws = playersWsMap.get(player.name);
  const connection =
    ws?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
  const inventoryCount = player.inventory.items.reduce(
    (sum, item) => sum + item.quantity,
    0,
  );
  const equipped = Object.entries(player.equipped)
    .filter(([, itemId]) => itemId !== undefined)
    .map(([slot, itemId]) => `${slot}:${itemId}`)
    .join(', ');

  return [
    `${style.title('Player')}: ${style.player(player.name)}`,
    `  ${style.muted('id')}: ${player.id}`,
    `  ${style.muted('access')}: ${style.value(accessLabel[player.access])}  ${style.muted('connection')}: ${
      connection === 'connected' ? style.ok(connection) : style.warn(connection)
    }`,
    `  ${style.muted('map')}: ${style.map(player.mapId)}${map?.name ? ` (${map.name})` : ''}`,
    `  pos: px (${player.position.x},${player.position.y})  tile (${t.x},${t.y})`,
    `  ${style.muted('hp')}: ${style.ok(`${player.health}/${player.maxHealth}`)}`,
    `  ${style.muted('level')}: ${style.value(String(player.level))}  ${style.muted('xp')}: ${player.experience}/${player.experienceToNextLevel}  ${style.muted('unspent')}: ${player.unspentPoints}`,
    `  attack: ${player.attack}  vitality: ${player.vitality}  speed: ${player.speed}  range: ${player.attackRange}`,
    `  action: ${player.action}  direction: ${player.direction}  moving: ${player.moving ? 'yes' : 'no'}`,
    `  inventory: ${inventoryCount}/${player.inventory.maxCapacity} item(s)`,
    `  equipped: ${equipped || 'none'}`,
    `  muted: ${isMuted(player.name) ? 'yes' : 'no'}  banned: ${banned ? 'yes' : 'no'}`,
  ];
}

export function registerPlayerCommands(): void {
  const listPlayers = ({ reply, style }: CommandContext) => {
    const players = onlinePlayers();
    if (players.length === 0) return reply(style.warn('No players online.'));

    reply(
      `${style.title('Online players')}: ${style.value(String(players.length))}`,
    );
    reply(
      style.muted(
        '  name             access map        level hp           tile',
      ),
    );
    reply(
      style.muted(
        '  ------------------------------------------------------------',
      ),
    );
    for (const player of players) {
      const t = tile(player.position);
      reply(
        `  ${style.player(player.name.padEnd(16))} ${style.value(accessLabel[player.access].padEnd(6))} ${style.map(player.mapId.padEnd(10))} ${style.value(String(player.level).padEnd(5))} ${style.ok(`${player.health}/${player.maxHealth}`.padEnd(12))} (${t.x},${t.y})`,
      );
    }
  };
  registerCommand(
    'players',
    { access: Access.MOD, description: 'List online players' },
    listPlayers,
  );
  registerCommand(
    'online',
    { access: Access.MOD, description: 'List online players' },
    listPlayers,
  );

  const whois = async ({ args, reply, style }: CommandContext) => {
    const player = requireOnline(args[0], { reply, style });
    if (!player) return;
    const ban = await getBan(player.name);
    for (const line of describePlayer(player, style, !!ban)) reply(line);
  };
  registerCommand(
    'whois',
    { access: Access.MOD, description: 'Show detailed player info' },
    whois,
  );
  registerCommand(
    'info',
    { access: Access.MOD, description: 'Show detailed player info' },
    whois,
  );

  registerCommand(
    'kick',
    { access: Access.MOD, description: 'Disconnect a player' },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: kick <username>');
      await kickPlayer(username, 'You were kicked by a server administrator.');
      reply(style.ok(`Kicked ${username}.`));
    },
  );

  registerCommand(
    'kill',
    {
      access: Access.ADMIN,
      description: 'Kill and respawn a player',
      forwardable: true,
    },
    ({ args, reply, style }) => {
      const player = requireOnline(args[0], { reply, style });
      if (!player) return;

      const reason = args.slice(1).join(' ');
      if (!killPlayer(player)) saveAndBroadcast([player]);
      sendPrivateMessage(
        player.name,
        reason
          ? `You were killed by an administrator: ${reason}`
          : 'You were killed by an administrator.',
      );
      const t = tile(player.position);
      reply(
        style.ok(
          `Killed ${player.name}; respawned on map ${player.mapId} tile (${t.x},${t.y}).`,
        ),
      );
    },
  );

  registerCommand(
    'heal',
    {
      access: Access.ADMIN,
      description: 'Heal a player: heal <name> [amount|full]',
      forwardable: true,
    },
    ({ args, reply, style }) => {
      const player = requireOnline(args[0], { reply, style });
      if (!player) return;

      const before = player.health;
      const amountArg = args[1];
      if (!amountArg || amountArg === 'full') {
        player.health = player.maxHealth;
      } else {
        const amount = parsePositiveInt(amountArg);
        if (amount === null) {
          return reply('Usage: heal <username> [amount|full]');
        }
        player.health = Math.min(player.maxHealth, player.health + amount);
      }

      saveAndBroadcast([player]);
      sendPrivateMessage(
        player.name,
        `An administrator healed you (${before} -> ${player.health} HP).`,
      );
      reply(
        style.ok(`Healed ${player.name}: ${before} -> ${player.health} HP.`),
      );
    },
  );

  const privateMessage = ({ args, reply, style }: CommandContext) => {
    const username = args[0];
    const message = args.slice(1).join(' ');
    if (!username || !message) return reply('Usage: pm <username> <message>');

    const player = requireOnline(username, { reply, style });
    if (!player) return;

    if (!sendPrivateMessage(player.name, message)) {
      return reply(
        style.error(`Could not send PM; ${player.name} is not connected.`),
      );
    }
    reply(style.ok(`PM sent to ${player.name}: ${message}`));
  };
  for (const name of ['pm', 'msg', 'tell']) {
    registerCommand(
      name,
      {
        access: Access.MOD,
        description: 'Private message visible only to one player',
        forwardable: true,
      },
      privateMessage,
    );
  }

  const teleport = async ({ args, reply, style }: CommandContext) => {
    const username = args[0];
    if (!username || args.length < 2) {
      reply('Usage: tp <username> <targetUser>');
      return reply('   or: tp <username> <mapId> <tileX> <tileY>');
    }

    const player = requireOnline(username, { reply, style });
    if (!player) return;

    const destination = await resolveDestination(args.slice(1));
    if (!destination.ok) return reply(destination.error);

    if (warpToMap(player, destination.mapId, destination.position)) {
      // Handed to the map's owner: the socket here is closing, and the client
      // reconnects there and is built from the document.
      return reply(
        style.ok(`Sent ${player.name} to ${destination.label}, on its owner.`),
      );
    }

    saveAndBroadcast([player]);
    sendPrivateMessage(
      player.name,
      `An administrator teleported you to ${destination.label}.`,
    );
    reply(style.ok(`Teleported ${player.name} to ${destination.label}.`));
  };
  for (const name of ['tp', 'teleport']) {
    registerCommand(
      name,
      {
        access: Access.ADMIN,
        description:
          'Teleport a player: tp <name> <targetName> | <mapId> <x> <y>',
        // The subject has to be a live character, so under sharding this runs
        // where the account is held. The redirect handles any third instance.
        forwardable: true,
      },
      teleport,
    );
  }

  registerCommand(
    'tpall',
    {
      access: Access.ADMIN,
      description: 'Teleport everyone: tpall <targetName> | <mapId> <x> <y>',
    },
    async ({ args, reply, style }) => {
      if (args.length < 1) {
        reply('Usage: tpall <targetUser>');
        return reply('   or: tpall <mapId> <tileX> <tileY>');
      }

      const destination = await resolveDestination(args);
      if (!destination.ok) return reply(destination.error);

      const players = onlinePlayers();
      if (players.length === 0) return reply(style.warn('No players online.'));

      // Everyone here, which under sharding is not everyone: the command acts
      // on the players this process has, and a destination it does not own
      // sends them across one by one.
      const stayed = players.filter(
        (player) => !warpToMap(player, destination.mapId, destination.position),
      );

      saveAndBroadcast(stayed);
      reply(
        style.ok(
          `Teleported ${players.length} player(s) to ${destination.label}.`,
        ),
      );
    },
  );

  registerCommand(
    'xpall',
    { access: Access.ADMIN, description: 'Grant XP to every online player' },
    ({ args, reply, style }) => {
      const amount = parsePositiveInt(args[0]);
      if (amount === null) return reply('Usage: xpall <amount>');

      const players = onlinePlayers();
      if (players.length === 0) return reply(style.warn('No players online.'));

      let levelsGained = 0;
      for (const player of players) {
        const beforeLevel = player.level;
        player.experience += amount;
        levelUpPlayer(player);
        levelsGained += player.level - beforeLevel;
      }

      saveAndBroadcast(players);
      reply(
        style.ok(
          `Granted ${amount} XP to ${players.length} player(s). Total levels gained: ${levelsGained}.`,
        ),
      );
    },
  );

  registerCommand(
    'levelall',
    {
      access: Access.ADMIN,
      description: 'Grant levels to every online player',
    },
    ({ args, reply, style }) => {
      const levels = parsePositiveInt(args[0]);
      if (levels === null) return reply('Usage: levelall <levels>');

      const players = onlinePlayers();
      if (players.length === 0) return reply(style.warn('No players online.'));

      for (const player of players) {
        player.level += levels;
        player.experienceToNextLevel = Math.floor(
          100 * Math.pow(1.5, player.level - 1),
        );
        player.unspentPoints += levels * POINTS_PER_LEVEL;
      }

      saveAndBroadcast(players);
      reply(
        style.ok(
          `Granted ${levels} level(s) to ${players.length} player(s). Each received ${levels * POINTS_PER_LEVEL} unspent point(s).`,
        ),
      );
    },
  );

  registerCommand(
    'ban',
    {
      access: Access.ADMIN,
      description: 'Ban a player: ban <name> [reason] [hours]',
    },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: ban <username> [reason] [hours]');

      const hoursArg = args[args.length - 1];
      const hours =
        hoursArg && !isNaN(Number(hoursArg)) ? Number(hoursArg) : undefined;
      const reasonParts =
        hours !== undefined ? args.slice(1, -1) : args.slice(1);
      const reason = reasonParts.length > 0 ? reasonParts.join(' ') : undefined;
      const until =
        hours !== undefined ? Date.now() + hours * 3600_000 : undefined;

      await banPlayer(username, reason, until);
      await kickPlayer(
        username,
        reason
          ? `You were banned: ${reason}`
          : 'You were banned from the game.',
      );
      const duration = hours !== undefined ? `for ${hours}h` : 'permanently';
      reply(
        style.ok(
          `Banned ${username} ${duration}${reason ? `: ${reason}` : ''}.`,
        ),
      );
    },
  );

  registerCommand(
    'unban',
    { access: Access.ADMIN, description: 'Remove a ban' },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: unban <username>');
      await unbanPlayer(username);
      reply(style.ok(`Unbanned ${username}.`));
    },
  );

  registerCommand(
    'baninfo',
    { access: Access.MOD, description: 'Check whether a player is banned' },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: baninfo <username>');
      const ban = await getBan(username);
      if (!ban) return reply(style.ok(`${username} is not banned.`));

      const until = ban.until
        ? `until ${new Date(ban.until).toLocaleString()}`
        : 'permanent';
      reply(
        style.warn(
          `${username} is banned (${until})${ban.reason ? ` - ${ban.reason}` : ''}.`,
        ),
      );
    },
  );

  registerCommand(
    'mute',
    {
      access: Access.ADMIN,
      description: 'Mute a player: mute <name> [minutes]',
    },
    ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: mute <username> [minutes]');
      const minutes = parsePositiveInt(args[1]);
      // Zero is the stored form of "no expiry", not a duration of none.
      const expiry = minutes !== null ? Date.now() + minutes * 60_000 : 0;
      serverState.mutes.set(username, expiry);
      // The mute is checked where the line is typed, which is wherever the
      // player is connected, not where the command was typed.
      publishToInstances('mute', { username, expiry });
      reply(
        style.ok(
          `Muted ${username} ${minutes !== null ? `for ${minutes}min` : 'permanently'}.`,
        ),
      );
    },
  );

  registerCommand(
    'unmute',
    { access: Access.ADMIN, description: 'Remove a mute' },
    ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: unmute <username>');
      serverState.mutes.delete(username);
      publishToInstances('mute', { username, expiry: null });
      reply(style.ok(`Unmuted ${username}.`));
    },
  );

  registerCommand(
    'muteinfo',
    { access: Access.MOD, description: 'Check whether a player is muted' },
    ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: muteinfo <username>');
      if (!isMuted(username))
        return reply(style.ok(`${username} is not muted.`));

      const expiry = serverState.mutes.get(username) ?? 0;
      const until =
        expiry === 0
          ? 'permanent'
          : `until ${new Date(expiry).toLocaleString()}`;
      reply(style.warn(`${username} is muted (${until}).`));
    },
  );

  // A way back in for a player who cannot log in, with no password seen by
  // the operator: the same single-use link the reset endpoint mails, handed
  // over here. The link is not logged, since the token is a bearer secret;
  // the audit trail records the command and its target.
  registerCommand(
    'resetlink',
    {
      access: Access.ADMIN,
      description: 'One-time password reset link: resetlink <username>',
    },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: resetlink <username>');

      const minted = await createResetToken(username);
      if (!minted) return reply(style.warn(`No account named ${username}.`));

      reply(style.ok(`Reset link for ${minted.username}:`));
      reply(resetLink(minted.token));
      reply(
        style.muted(
          `Single use, and it stops working at ${minted.expiresAt.toLocaleString()}.`,
        ),
      );
    },
  );

  // Account data: export and erasure. The obligation is the operator's, but
  // without a command it is a hand-written Mongo query. As commands they get
  // the access gate and the audit trail of every other privileged action.
  registerCommand(
    'accountexport',
    {
      access: Access.ADMIN,
      description: 'Everything stored about a player: accountexport <username>',
    },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: accountexport <username>');

      const record = await getPlayerByNameFromDb(username);
      if (!record) return reply(style.warn(`No account named ${username}.`));

      // The hash is the one field that is about the account rather than the
      // person, and handing it out helps an attacker and nobody else.
      const { password: _password, ...personal } = record;
      const [mail, ban, twoFactor, activity] = await Promise.all([
        listDeliveries(username),
        getBan(username),
        // Whether there is a second factor, never its secret, for the same
        // reason the hash is dropped.
        twoFactorStatus(username),
        // Which days they played, which is the other thing stored about a
        // person rather than about their character.
        activityOf(username),
      ]);

      reply(
        JSON.stringify(
          { player: personal, mail, ban: ban ?? null, twoFactor, activity },
          null,
          2,
        ),
      );
    },
  );

  /**
   * The way back in when the phone and the printed codes are both gone. Off
   * only: enrolling means holding the secret, and a secret that passed through
   * an operator is not a second factor. The owner enrolls again from the panel.
   */
  registerCommand(
    'twofactor',
    {
      access: Access.ADMIN,
      description: 'Second factor of an account: twofactor <username> [off]',
    },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: twofactor <username> [off]');

      const record = await getPlayerByNameFromDb(username);
      if (!record) return reply(style.warn(`No account named ${username}.`));

      if (args[1] === 'off') {
        const removed = await disableTwoFactor(username);
        return reply(
          removed
            ? style.ok(
                `Second factor removed from ${username}. They can enroll again from the panel.`,
              )
            : style.warn(`${username} had no second factor.`),
        );
      }

      const status = await twoFactorStatus(username);
      reply(
        status.enabled
          ? `${style.player(username)}: second factor ${style.value('on')}, ${style.value(String(status.recoveryLeft))} recovery codes left. Remove with: twofactor ${username} off`
          : `${style.player(username)}: second factor ${style.value('off')}.`,
      );
    },
  );

  registerCommand(
    'accountdelete',
    {
      access: Access.ADMIN,
      description:
        'Erase an account and its mail: accountdelete <username> confirm',
    },
    async ({ args, reply, style }) => {
      const username = args[0];
      if (!username) return reply('Usage: accountdelete <username> confirm');
      // Typed confirmation, because this is the one command here with nothing
      // behind it: there is no undo and no copy.
      if (args[1] !== 'confirm') {
        return reply(
          style.warn(
            `This erases ${username} permanently. Repeat as: accountdelete ${username} confirm`,
          ),
        );
      }

      const record = await getPlayerByNameFromDb(username);
      if (!record) return reply(style.warn(`No account named ${username}.`));

      // Disconnected and awaited first: a live session holds the player in
      // memory, and its flush would write the deleted document back.
      const online = getPlayerByName(username);
      if (online) {
        playersWsMap.get(username)?.close();
        await disconnectPlayer(username);
      }

      const mail = await listDeliveries(username);
      for (const entry of mail) await cancelDelivery(entry.id);
      // The second factor goes with the account, unlike the ban below: it is
      // keyed by name too, and a row left behind would demand a code from
      // whoever registers that name next, from a secret nobody holds.
      await disableTwoFactor(username);
      // The activity history is anonymised rather than erased: those rows are
      // what yesterday's player count was made of, and deleting them would
      // move a number somebody has already read. See analyticsService.
      const days = await forgetPlayer(username);
      await deletePlayer(record.id);

      // The ban stays: it is keyed by name and is all that stops the account
      // being made again to escape it. Erasing a banned account on request
      // means unbanning first.
      const banned = await getBan(username);
      reply(
        style.ok(
          `Erased ${username}: account and ${mail.length} queued mail.` +
            (days ? ` ${days} days of activity anonymised.` : '') +
            (banned ? ' The ban on that name was kept.' : ''),
        ),
      );
    },
  );
}
