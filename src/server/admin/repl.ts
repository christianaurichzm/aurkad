import readline from 'readline';
import { WebSocket } from 'ws';
import { TILE_SIZE } from '../../shared/constants.js';
import {
  Access,
  CharacterAction,
  type ChatMessagePayload,
  type PlayerServer,
  type Position,
} from '../../shared/types.js';
import { getGameState, kickPlayer } from '../services/gameService.js';
import { banPlayer, unbanPlayer, getBan } from '../services/banService.js';
import { broadcast, broadcastChat, playersWsMap } from '../net/index.js';
import { getMetrics } from '../metrics.js';
import { getChatLog } from '../services/chatService.js';
import { handleReplCommand } from '../engine/commands.js';
import { serverState, isMuted, type ServerMode } from '../serverState.js';
import { updatePlayer } from '../gameData.js';
import { updatePlayerMap } from '../services/mapService.js';
import {
  getPlayerByName,
  levelUpPlayer,
  respawnPlayer,
} from '../services/playerService.js';

const POINTS_PER_LEVEL = 5;
const COMMANDS = [
  'help',
  'players',
  'online',
  'maps',
  'whois',
  'info',
  'kill',
  'heal',
  'pm',
  'msg',
  'tell',
  'tp',
  'teleport',
  'tpall',
  'xpall',
  'levelall',
  'kick',
  'ban',
  'unban',
  'baninfo',
  'broadcast',
  'say',
  'chat',
  'stats',
  'mode',
  'motd',
  'mute',
  'unmute',
  'muteinfo',
  'exit',
  'quit',
  'q',
];

const accessLabel: Record<Access, string> = {
  [Access.USER]: 'USER',
  [Access.MOD]: 'MOD',
  [Access.ADMIN]: 'ADMIN',
};

const COLOR_ENABLED = process.stdout.isTTY && !process.env.NO_COLOR;
const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

function paint(text: string, ...codes: string[]): string {
  if (!COLOR_ENABLED) return text;
  return `${codes.join('')}${text}${ansi.reset}`;
}

const ui = {
  title: (text: string) => paint(text, ansi.bold, ansi.cyan),
  section: (text: string) => paint(text, ansi.bold, ansi.yellow),
  command: (text: string) => paint(text, ansi.cyan),
  player: (text: string) => paint(text, ansi.bold, ansi.magenta),
  map: (text: string) => paint(text, ansi.blue),
  ok: (text: string) => paint(text, ansi.green),
  warn: (text: string) => paint(text, ansi.yellow),
  error: (text: string) => paint(text, ansi.red),
  muted: (text: string) => paint(text, ansi.gray),
  value: (text: string) => paint(text, ansi.bold),
};

function out(line: string) {
  process.stdout.write(line + '\n');
}

function printBlock(lines: string[]) {
  lines.forEach(out);
}

function fmt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function prompt(): string {
  const modeColor =
    serverState.mode === 'normal'
      ? ansi.green
      : serverState.mode === 'maintenance'
        ? ansi.yellow
        : ansi.magenta;

  return `${paint('admin', ansi.bold, ansi.cyan)}:${paint(serverState.mode, ansi.bold, modeColor)}> `;
}

function tile(position: Position): Position {
  return {
    x: Math.round(position.x / TILE_SIZE),
    y: Math.round(position.y / TILE_SIZE),
  };
}

function posFromTile(x: number, y: number): Position {
  return {
    x: x * TILE_SIZE,
    y: y * TILE_SIZE,
  };
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

function getOnlinePlayers(): PlayerServer[] {
  const state = getGameState();
  const byId = new Map<string, PlayerServer>();

  for (const map of Object.values(state.maps)) {
    for (const player of Object.values(map.players)) {
      byId.set(player.id, player);
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findOnlinePlayer(username: string | undefined): PlayerServer | null {
  if (!username) return null;
  return getPlayerByName(username) ?? null;
}

function requireOnlinePlayer(
  username: string | undefined,
): PlayerServer | null {
  const player = findOnlinePlayer(username);
  if (!player) out(ui.error(`Player not online: ${username ?? '<missing>'}`));
  return player;
}

function resetMovement(player: PlayerServer): void {
  player.targetPosition = undefined;
  player.moving = false;
  player.action = CharacterAction.Idle;
  player.moveTick = undefined;
  player.moveDurationTicks = undefined;
}

async function saveAndBroadcast(players: PlayerServer[]): Promise<void> {
  const unique = new Map(players.map((player) => [player.id, player]));

  for (const player of unique.values()) {
    await updatePlayer(player);
  }

  broadcast();
}

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

function teleportPlayer(
  player: PlayerServer,
  mapId: string,
  position: Position,
): void {
  const previousMapId = player.mapId;
  player.mapId = mapId;
  player.position = { ...position };
  resetMovement(player);
  updatePlayerMap(player.id, player, previousMapId);
}

type TeleportDestination =
  | {
      ok: true;
      mapId: string;
      position: Position;
      label: string;
    }
  | {
      ok: false;
      error: string;
    };

function resolveTeleportDestination(args: string[]): TeleportDestination {
  if (args.length === 1) {
    const target = findOnlinePlayer(args[0]);
    if (!target) {
      return { ok: false, error: `Target player not online: ${args[0]}` };
    }

    const t = tile(target.position);
    return {
      ok: true,
      mapId: target.mapId,
      position: { ...target.position },
      label: `${target.name} on map ${target.mapId} tile (${t.x},${t.y})`,
    };
  }

  if (args.length === 3) {
    const [mapId, xArg, yArg] = args;
    if (!mapId || !getGameState().maps[mapId]) {
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

function setLevelProgression(player: PlayerServer, levels: number): void {
  player.level += levels;
  player.experienceToNextLevel = Math.floor(
    100 * Math.pow(1.5, player.level - 1),
  );
  player.unspentPoints += levels * POINTS_PER_LEVEL;
}

function printHelp() {
  printBlock([
    '',
    ui.title('Admin console commands'),
    '',
    ui.section('Players'),
    `  ${ui.command('players | online')}                 list online players`,
    `  ${ui.command('whois <user>')}                     show detailed player info`,
    `  ${ui.command('kill <user> [reason]')}             kill and respawn a player`,
    `  ${ui.command('heal <user> [amount|full]')}        heal a player, full by default`,
    `  ${ui.command('tp <user> <targetUser>')}           teleport a player to another player`,
    `  ${ui.command('tp <user> <mapId> <tileX> <tileY>')} teleport a player to map tile coords`,
    `  ${ui.command('tpall <targetUser>')}               teleport all players to a player`,
    `  ${ui.command('tpall <mapId> <tileX> <tileY>')}    teleport all players to map tile coords`,
    '',
    ui.section('Progression'),
    `  ${ui.command('xpall <amount>')}                   grant XP to every online player`,
    `  ${ui.command('levelall <levels>')}                grant levels to every online player`,
    '',
    ui.section('Chat'),
    `  ${ui.command('pm <user> <message>')}              private message visible only to user`,
    `  ${ui.command('broadcast <message>')}              send global announcement`,
    `  ${ui.command('chat [n]')}                         show last n chat messages (default 20)`,
    '',
    ui.section('Moderation'),
    `  ${ui.command('kick <user>')}                      disconnect a player`,
    `  ${ui.command('ban <user> [reason] [hours]')}      ban a player, permanent if no hours`,
    `  ${ui.command('unban <user>')}                     remove a ban`,
    `  ${ui.command('baninfo <user>')}                   check if a player is banned`,
    `  ${ui.command('mute <user> [minutes]')}            mute a player, permanent if no minutes`,
    `  ${ui.command('unmute <user>')}                    remove a mute`,
    `  ${ui.command('muteinfo <user>')}                  check if a player is muted`,
    '',
    ui.section('Server'),
    `  ${ui.command('maps')}                             list active maps and entity counts`,
    `  ${ui.command('stats')}                            show server metrics`,
    `  ${ui.command('mode [normal|maintenance|gm_only]')} get or set server access mode`,
    `  ${ui.command('motd [message|clear]')}             get, set or clear the MOTD`,
    `  ${ui.command('help | ?')}                         show this message`,
    `  ${ui.command('exit | quit')}                      close admin console, server keeps running`,
    '',
  ]);
}

async function handleCommand(cmd: string, args: string[]): Promise<void> {
  switch (cmd) {
    case 'help':
    case '?':
      printHelp();
      break;

    case 'online':
    case 'players': {
      const players = getOnlinePlayers();
      if (players.length === 0) {
        out(ui.warn('No players online.'));
      } else {
        out(
          `${ui.title('Online players')}: ${ui.value(String(players.length))}`,
        );
        out(
          ui.muted(
            '  name             access map        level hp           tile',
          ),
        );
        out(
          ui.muted(
            '  ------------------------------------------------------------',
          ),
        );
        for (const player of players) {
          const t = tile(player.position);
          out(
            `  ${ui.player(player.name.padEnd(16))} ${ui.command(accessLabel[player.access].padEnd(6))} ${ui.map(player.mapId.padEnd(10))} ${ui.value(String(player.level).padEnd(5))} ${ui.ok(`${player.health}/${player.maxHealth}`.padEnd(12))} (${t.x},${t.y})`,
          );
        }
      }
      break;
    }

    case 'maps': {
      const state = getGameState();
      const entries = Object.entries(state.maps);
      if (entries.length === 0) {
        out(ui.warn('No active maps.'));
      } else {
        out(`${ui.title('Active maps')}: ${ui.value(String(entries.length))}`);
        for (const [mapId, map] of entries) {
          const p = Object.keys(map.players).length;
          const n = Object.keys(map.npcs).length;
          out(
            `  ${ui.map(mapId.padEnd(20))} players:${ui.value(String(p))}  npcs:${ui.value(String(n))}`,
          );
        }
      }
      break;
    }

    case 'whois':
    case 'info': {
      const username = args[0];
      if (!username) {
        out('Usage: whois <username>');
        break;
      }

      const player = requireOnlinePlayer(username);
      if (!player) break;

      const state = getGameState();
      const map = state.maps[player.mapId];
      const t = tile(player.position);
      const ws = playersWsMap.get(player.name);
      const connection =
        ws?.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
      const ban = await getBan(player.name);
      const inventoryCount = player.inventory.items.reduce(
        (sum, item) => sum + item.quantity,
        0,
      );
      const equipped = Object.entries(player.equipped)
        .filter(([, itemId]) => itemId !== undefined)
        .map(([slot, itemId]) => `${slot}:${itemId}`)
        .join(', ');

      printBlock([
        `${ui.title('Player')}: ${ui.player(player.name)}`,
        `  ${ui.muted('id')}: ${player.id}`,
        `  ${ui.muted('access')}: ${ui.command(accessLabel[player.access])}  ${ui.muted('connection')}: ${
          connection === 'connected' ? ui.ok(connection) : ui.warn(connection)
        }`,
        `  ${ui.muted('map')}: ${ui.map(player.mapId)}${map?.name ? ` (${map.name})` : ''}`,
        `  pos: px (${player.position.x},${player.position.y})  tile (${t.x},${t.y})`,
        `  ${ui.muted('hp')}: ${ui.ok(`${player.health}/${player.maxHealth}`)}`,
        `  ${ui.muted('level')}: ${ui.value(String(player.level))}  ${ui.muted('xp')}: ${player.experience}/${player.experienceToNextLevel}  ${ui.muted('unspent')}: ${player.unspentPoints}`,
        `  attack: ${player.attack}  vitality: ${player.vitality}  speed: ${player.speed}  range: ${player.attackRange}`,
        `  action: ${player.action}  direction: ${player.direction}  moving: ${player.moving ? 'yes' : 'no'}`,
        `  inventory: ${inventoryCount}/${player.inventory.maxCapacity} item(s)`,
        `  equipped: ${equipped || 'none'}`,
        `  muted: ${isMuted(player.name) ? 'yes' : 'no'}  banned: ${ban ? 'yes' : 'no'}`,
      ]);
      break;
    }

    case 'kick': {
      const username = args[0];
      if (!username) {
        out('Usage: kick <username>');
        break;
      }
      await kickPlayer(username, 'You were kicked by a server administrator.');
      out(ui.ok(`Kicked ${username}.`));
      break;
    }

    case 'kill': {
      const username = args[0];
      if (!username) {
        out('Usage: kill <username> [reason]');
        break;
      }

      const player = requireOnlinePlayer(username);
      if (!player) break;

      const reason = args.slice(1).join(' ');
      player.health = 0;
      respawnPlayer(player);
      await saveAndBroadcast([player]);
      sendPrivateMessage(
        player.name,
        reason
          ? `You were killed by an administrator: ${reason}`
          : 'You were killed by an administrator.',
      );
      const t = tile(player.position);
      out(
        ui.ok(
          `Killed ${player.name}; respawned on map ${player.mapId} tile (${t.x},${t.y}).`,
        ),
      );
      break;
    }

    case 'heal': {
      const username = args[0];
      if (!username) {
        out('Usage: heal <username> [amount|full]');
        break;
      }

      const player = requireOnlinePlayer(username);
      if (!player) break;

      const before = player.health;
      const amountArg = args[1];
      if (!amountArg || amountArg === 'full') {
        player.health = player.maxHealth;
      } else {
        const amount = parsePositiveInt(amountArg);
        if (amount === null) {
          out('Usage: heal <username> [amount|full]');
          break;
        }
        player.health = Math.min(player.maxHealth, player.health + amount);
      }

      await saveAndBroadcast([player]);
      sendPrivateMessage(
        player.name,
        `An administrator healed you (${before} -> ${player.health} HP).`,
      );
      out(ui.ok(`Healed ${player.name}: ${before} -> ${player.health} HP.`));
      break;
    }

    case 'pm':
    case 'msg':
    case 'tell': {
      const username = args[0];
      const message = args.slice(1).join(' ');
      if (!username || !message) {
        out('Usage: pm <username> <message>');
        break;
      }

      const player = requireOnlinePlayer(username);
      if (!player) break;

      if (!sendPrivateMessage(player.name, message)) {
        out(ui.error(`Could not send PM; ${player.name} is not connected.`));
        break;
      }
      out(ui.ok(`PM sent to ${player.name}: ${message}`));
      break;
    }

    case 'tp':
    case 'teleport': {
      const username = args[0];
      if (!username || args.length < 2) {
        out('Usage: tp <username> <targetUser>');
        out('   or: tp <username> <mapId> <tileX> <tileY>');
        break;
      }

      const player = requireOnlinePlayer(username);
      if (!player) break;

      const destination = resolveTeleportDestination(args.slice(1));
      if (!destination.ok) {
        out(destination.error);
        break;
      }

      teleportPlayer(player, destination.mapId, destination.position);
      await saveAndBroadcast([player]);
      sendPrivateMessage(
        player.name,
        `An administrator teleported you to ${destination.label}.`,
      );
      out(ui.ok(`Teleported ${player.name} to ${destination.label}.`));
      break;
    }

    case 'tpall': {
      if (args.length < 1) {
        out('Usage: tpall <targetUser>');
        out('   or: tpall <mapId> <tileX> <tileY>');
        break;
      }

      const destination = resolveTeleportDestination(args);
      if (!destination.ok) {
        out(destination.error);
        break;
      }

      const players = getOnlinePlayers();
      if (players.length === 0) {
        out(ui.warn('No players online.'));
        break;
      }

      for (const player of players) {
        teleportPlayer(player, destination.mapId, destination.position);
      }

      await saveAndBroadcast(players);
      out(
        ui.ok(
          `Teleported ${players.length} player(s) to ${destination.label}.`,
        ),
      );
      break;
    }

    case 'xpall': {
      const amount = parsePositiveInt(args[0]);
      if (amount === null) {
        out('Usage: xpall <amount>');
        break;
      }

      const players = getOnlinePlayers();
      if (players.length === 0) {
        out(ui.warn('No players online.'));
        break;
      }

      let levelsGained = 0;
      for (const player of players) {
        const beforeLevel = player.level;
        player.experience += amount;
        levelUpPlayer(player);
        levelsGained += player.level - beforeLevel;
      }

      await saveAndBroadcast(players);
      out(
        ui.ok(
          `Granted ${amount} XP to ${players.length} player(s). Total levels gained: ${levelsGained}.`,
        ),
      );
      break;
    }

    case 'levelall': {
      const levels = parsePositiveInt(args[0]);
      if (levels === null) {
        out('Usage: levelall <levels>');
        break;
      }

      const players = getOnlinePlayers();
      if (players.length === 0) {
        out(ui.warn('No players online.'));
        break;
      }

      for (const player of players) {
        setLevelProgression(player, levels);
      }

      await saveAndBroadcast(players);
      out(
        ui.ok(
          `Granted ${levels} level(s) to ${players.length} player(s). Each received ${levels * POINTS_PER_LEVEL} unspent point(s).`,
        ),
      );
      break;
    }

    case 'ban': {
      const username = args[0];
      if (!username) {
        out('Usage: ban <username> [reason] [hours]');
        break;
      }
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
      out(
        ui.ok(`Banned ${username} ${duration}${reason ? `: ${reason}` : ''}.`),
      );
      break;
    }

    case 'unban': {
      const username = args[0];
      if (!username) {
        out('Usage: unban <username>');
        break;
      }
      await unbanPlayer(username);
      out(ui.ok(`Unbanned ${username}.`));
      break;
    }

    case 'baninfo': {
      const username = args[0];
      if (!username) {
        out('Usage: baninfo <username>');
        break;
      }
      const ban = await getBan(username);
      if (!ban) {
        out(ui.ok(`${username} is not banned.`));
      } else {
        const until = ban.until
          ? `until ${new Date(ban.until).toLocaleString()}`
          : 'permanent';
        out(
          ui.warn(
            `${username} is banned (${until})${ban.reason ? ` - ${ban.reason}` : ''}.`,
          ),
        );
      }
      break;
    }

    case 'say':
    case 'broadcast': {
      const message = args.join(' ');
      if (!message) {
        out('Usage: broadcast <message>');
        break;
      }
      broadcastChat({
        type: 'chat',
        scope: 'global',
        message,
        username: '[SERVER]',
      });
      out(ui.ok(`Broadcast sent: ${message}`));
      break;
    }

    case 'chat': {
      const n = args[0] ? parseInt(args[0], 10) : 20;
      const entries = getChatLog(isNaN(n) ? 20 : n);
      if (entries.length === 0) {
        out(ui.warn('No chat messages yet.'));
      } else {
        for (const e of entries) {
          const who = e.username ? e.username : '[server]';
          out(
            `  ${ui.muted(`[${fmt(e.ts)}]`)} ${ui.command(`[${e.scope}]`)} ${ui.player(who)}: ${e.message}`,
          );
        }
      }
      break;
    }

    case 'stats': {
      const m = getMetrics();
      out(
        `${ui.title('Uptime')}: ${ui.value(`${m.uptime}s`)}  |  WS: ${ui.value(String(m.wsConnections))}  |  Players: ${ui.value(String(m.players))}  |  NPCs: ${ui.value(String(m.npcs))}  |  Maps: ${ui.value(String(m.maps))}`,
      );
      out(
        `${ui.title('Tick')}: avg ${ui.value(`${m.tick.avgMs}ms`)}  queue: ${ui.value(String(m.tick.avgQueueSize))}  (${m.tick.samples} samples)`,
      );
      break;
    }

    case 'mode': {
      const newMode = args[0] as ServerMode | undefined;
      if (!newMode) {
        out(`${ui.title('Server mode')}: ${ui.value(serverState.mode)}`);
        break;
      }
      if (
        newMode !== 'normal' &&
        newMode !== 'maintenance' &&
        newMode !== 'gm_only'
      ) {
        out('Usage: mode [normal|maintenance|gm_only]');
        break;
      }
      serverState.mode = newMode;
      out(ui.ok(`Server mode set to: ${newMode}`));
      if (newMode !== 'normal') {
        const msg =
          newMode === 'maintenance'
            ? 'Server entering maintenance mode. New logins are restricted.'
            : 'Server is now GM-only. New logins are restricted.';
        broadcastChat({
          type: 'chat',
          scope: 'global',
          message: msg,
          username: '[SERVER]',
        });
      }
      break;
    }

    case 'motd': {
      if (args.length === 0) {
        out(
          serverState.motd
            ? `${ui.title('MOTD')}: ${serverState.motd}`
            : ui.warn('No MOTD set.'),
        );
        break;
      }
      if (args[0] === 'clear') {
        serverState.motd = '';
        out(ui.ok('MOTD cleared.'));
        break;
      }
      serverState.motd = args.join(' ');
      out(ui.ok(`MOTD set: ${serverState.motd}`));
      break;
    }

    case 'mute': {
      const username = args[0];
      if (!username) {
        out('Usage: mute <username> [minutes]');
        break;
      }
      const minutes =
        args[1] && !isNaN(Number(args[1])) ? Number(args[1]) : undefined;
      const expiry = minutes !== undefined ? Date.now() + minutes * 60_000 : 0;
      serverState.mutes.set(username, expiry);
      const duration =
        minutes !== undefined ? `for ${minutes}min` : 'permanently';
      out(ui.ok(`Muted ${username} ${duration}.`));
      break;
    }

    case 'unmute': {
      const username = args[0];
      if (!username) {
        out('Usage: unmute <username>');
        break;
      }
      serverState.mutes.delete(username);
      out(ui.ok(`Unmuted ${username}.`));
      break;
    }

    case 'muteinfo': {
      const username = args[0];
      if (!username) {
        out('Usage: muteinfo <username>');
        break;
      }
      if (!isMuted(username)) {
        out(ui.ok(`${username} is not muted.`));
      } else {
        const expiry = serverState.mutes.get(username)!;
        const until =
          expiry === 0
            ? 'permanent'
            : `until ${new Date(expiry).toLocaleString()}`;
        out(ui.warn(`${username} is muted (${until}).`));
      }
      break;
    }

    case 'exit':
    case 'quit':
    case 'q':
      return; // signals caller to close

    case '':
      break;

    default:
      if (handleReplCommand(cmd, args, out)) break;
      out(ui.error(`Unknown command: ${cmd}. Type 'help' for a list.`));
  }
}

export function startAdminRepl(): void {
  if (!process.stdin.isTTY) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: prompt(),
    terminal: true,
    completer: (line: string) => {
      const hits = COMMANDS.filter((command) => command.startsWith(line));
      return [hits.length ? hits : COMMANDS, line];
    },
  });

  out(ui.ok('Admin console ready.'));
  out(
    `${ui.muted('Type')} ${ui.command('help')} ${ui.muted('for commands. Press Tab to complete command names.')}`,
  );
  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0] ?? '';
    const args = parts.slice(1);

    if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
      out(ui.warn('Admin console closed. Server still running.'));
      rl.close();
      return;
    }

    try {
      await handleCommand(cmd, args);
    } catch (err) {
      out(
        ui.error(`Error: ${err instanceof Error ? err.message : String(err)}`),
      );
    }

    rl.setPrompt(prompt());
    rl.prompt();
  });

  rl.on('close', () => {
    // stdin EOF, e.g. piped input finished; the server keeps running.
  });
}
