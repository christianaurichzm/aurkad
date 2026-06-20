import readline from 'readline';
import { getGameState, kickPlayer } from '../services/gameService.js';
import { banPlayer, unbanPlayer, getBan } from '../services/banService.js';
import { broadcastChat } from '../net/index.js';
import { getMetrics } from '../metrics.js';
import { getChatLog } from '../services/chatService.js';
import { serverState, isMuted, type ServerMode } from '../serverState.js';

const PROMPT = 'admin> ';

function out(line: string) {
  process.stdout.write(line + '\n');
}

function fmt(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString();
}

async function handleCommand(cmd: string, args: string[]): Promise<void> {
  switch (cmd) {
    case 'help':
    case '?':
      out(
        `
Commands:
  players              list online players
  maps                 list active maps and entity counts
  kick <user>          disconnect a player
  ban <user> [reason] [hours]   ban a player (permanent if no hours)
  unban <user>         remove a ban
  baninfo <user>       check if a player is banned
  broadcast <message>  send global announcement to all players
  chat [n]             show last n chat messages (default 20)
  stats                show server metrics
  mode [normal|maintenance|gm_only]  get or set server access mode
  motd [message|clear]               get, set or clear the MOTD
  mute <user> [minutes]              mute a player (permanent if no minutes)
  unmute <user>                      remove a mute
  muteinfo <user>                    check if a player is muted
  help                 show this message
  exit | quit          close admin console (server keeps running)
`.trim(),
      );
      break;

    case 'players': {
      const state = getGameState();
      const entries: string[] = [];
      for (const [mapId, map] of Object.entries(state.maps)) {
        for (const player of Object.values(map.players)) {
          entries.push(
            `  ${player.name.padEnd(16)} map:${mapId.padEnd(12)} hp:${player.health}/${player.maxHealth}  pos:(${player.position.x},${player.position.y})`,
          );
        }
      }
      if (entries.length === 0) {
        out('No players online.');
      } else {
        out(`Online: ${entries.length} player(s)`);
        entries.forEach(out);
      }
      break;
    }

    case 'maps': {
      const state = getGameState();
      const entries = Object.entries(state.maps);
      if (entries.length === 0) {
        out('No active maps.');
      } else {
        out(`Active maps: ${entries.length}`);
        for (const [mapId, map] of entries) {
          const p = Object.keys(map.players).length;
          const n = Object.keys(map.npcs).length;
          out(`  ${mapId.padEnd(20)} players:${p}  npcs:${n}`);
        }
      }
      break;
    }

    case 'kick': {
      const username = args[0];
      if (!username) {
        out('Usage: kick <username>');
        break;
      }
      await kickPlayer(username, 'You were kicked by a server administrator.');
      out(`Kicked ${username}.`);
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
      out(`Banned ${username} ${duration}${reason ? `: ${reason}` : ''}.`);
      break;
    }

    case 'unban': {
      const username = args[0];
      if (!username) {
        out('Usage: unban <username>');
        break;
      }
      await unbanPlayer(username);
      out(`Unbanned ${username}.`);
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
        out(`${username} is not banned.`);
      } else {
        const until = ban.until
          ? `until ${new Date(ban.until).toLocaleString()}`
          : 'permanent';
        out(
          `${username} is banned (${until})${ban.reason ? ` - ${ban.reason}` : ''}.`,
        );
      }
      break;
    }

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
      out(`Broadcast sent: ${message}`);
      break;
    }

    case 'chat': {
      const n = args[0] ? parseInt(args[0], 10) : 20;
      const entries = getChatLog(isNaN(n) ? 20 : n);
      if (entries.length === 0) {
        out('No chat messages yet.');
      } else {
        for (const e of entries) {
          const who = e.username ? e.username : '[server]';
          out(`  [${fmt(e.ts)}] [${e.scope}] ${who}: ${e.message}`);
        }
      }
      break;
    }

    case 'stats': {
      const m = getMetrics();
      out(
        `Uptime: ${m.uptime}s  |  WS: ${m.wsConnections}  |  Players: ${m.players}  |  NPCs: ${m.npcs}  |  Maps: ${m.maps}`,
      );
      out(
        `Tick: avg ${m.tick.avgMs}ms  queue: ${m.tick.avgQueueSize}  (${m.tick.samples} samples)`,
      );
      break;
    }

    case 'mode': {
      const newMode = args[0] as ServerMode | undefined;
      if (!newMode) {
        out(`Server mode: ${serverState.mode}`);
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
      out(`Server mode set to: ${newMode}`);
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
        out(serverState.motd ? `MOTD: ${serverState.motd}` : 'No MOTD set.');
        break;
      }
      if (args[0] === 'clear') {
        serverState.motd = '';
        out('MOTD cleared.');
        break;
      }
      serverState.motd = args.join(' ');
      out(`MOTD set: ${serverState.motd}`);
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
      out(`Muted ${username} ${duration}.`);
      break;
    }

    case 'unmute': {
      const username = args[0];
      if (!username) {
        out('Usage: unmute <username>');
        break;
      }
      serverState.mutes.delete(username);
      out(`Unmuted ${username}.`);
      break;
    }

    case 'muteinfo': {
      const username = args[0];
      if (!username) {
        out('Usage: muteinfo <username>');
        break;
      }
      if (!isMuted(username)) {
        out(`${username} is not muted.`);
      } else {
        const expiry = serverState.mutes.get(username)!;
        const until =
          expiry === 0
            ? 'permanent'
            : `until ${new Date(expiry).toLocaleString()}`;
        out(`${username} is muted (${until}).`);
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
      out(`Unknown command: ${cmd}. Type 'help' for a list.`);
  }
}

export function startAdminRepl(): void {
  if (!process.stdin.isTTY) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: PROMPT,
    terminal: true,
  });

  out("Admin console ready. Type 'help' for commands.");
  rl.prompt();

  rl.on('line', async (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0] ?? '';
    const args = parts.slice(1);

    if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
      out('Admin console closed. Server still running.');
      rl.close();
      return;
    }

    try {
      await handleCommand(cmd, args);
    } catch (err) {
      out(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    // stdin EOF, e.g. piped input finished; the server keeps running.
  });
}
