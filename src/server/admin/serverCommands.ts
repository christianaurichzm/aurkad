import { registerCommand } from '../engine/commands.js';
import { isSuspicious, runCensus } from '../services/economy/economyCensus.js';
import { Access } from '../../shared/types.js';
import { serverState, type ServerMode } from '../services/world/serverState.js';
import { handleChatAction } from '../services/comms/chatService.js';
import { getRuntimeState } from '../services/world/gameData.js';
import {
  clearFlag,
  listFlags,
  setFlag,
  type FlagValue,
  type LiveOpsFlag,
} from '../services/liveOpsService.js';

// Server-wide ops as registry commands, so they work from the web console
// and in-game chat, access-gated. The terminal REPL matches its own richer
// built-ins first, so these never shadow it. Registered once at boot.

/**
 * Reads the value an operator typed. `2` is a multiplier and `true` a switch,
 * typed the same way, so the type comes from the argument's shape.
 */
function parseFlagValue(raw: string): FlagValue {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const asNumber = Number(raw);
  return raw !== '' && Number.isFinite(asNumber) ? asNumber : raw;
}

/** Operators read "3h20m", not an epoch. Rounds up: 0m would read as over. */
function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest ? `${days}d${rest}h` : `${days}d`;
}

/**
 * Reads a start time an operator typed:
 *
 *   `20:00`               the next time the server clock reads that
 *   `+2h` / `+90` / `+3d` from now, minutes when the unit is left off
 *   `2026-08-02T20:00`    a full timestamp
 *
 * NaN when it is none of those; the caller then replies with the three forms.
 */
function parseWhen(raw: string, now: number): number {
  const relative = /^\+(\d+)([mhd])?$/i.exec(raw);
  if (relative) {
    const unit = (relative[2] ?? 'm').toLowerCase();
    const ms = unit === 'h' ? 3_600_000 : unit === 'd' ? 86_400_000 : 60_000;
    return now + Number(relative[1]) * ms;
  }

  const clock = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (clock) {
    const hours = Number(clock[1]);
    const minutes = Number(clock[2]);
    if (hours > 23 || minutes > 59) return NaN;
    const at = new Date(now);
    at.setHours(hours, minutes, 0, 0);
    // Past today means they mean tomorrow: nobody schedules an event for a
    // time that went by this morning.
    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
    return at.getTime();
  }

  return new Date(raw).getTime();
}

interface FlagTiming {
  startsAt?: number;
  expiresAt?: number;
  note: string;
}

/**
 * `at <when>` and `for <minutes>` in either order, then the rest as the note.
 * A bare leading number still means minutes, as operators already type it.
 * The keywords count only before the note, so `... sale at half price` is a
 * note. Returns the reply when a time cannot be read, as a guess would
 * schedule the wrong day.
 */
function parseFlagTiming(rest: string[], now: number): FlagTiming | string {
  const queue = [...rest];
  const words: string[] = [];
  let startsAt: number | undefined;
  let minutes: number | undefined;

  while (queue.length) {
    const token = queue.shift();
    if (token === undefined) break;
    const keyword = token.toLowerCase();

    if (!words.length && (keyword === 'at' || keyword === 'for')) {
      const argument = queue.shift();
      if (argument === undefined) {
        return `"${keyword}" needs a value: at 20:00, for 120.`;
      }

      if (keyword === 'at') {
        const parsed = parseWhen(argument, now);
        if (!Number.isFinite(parsed)) {
          return `I cannot read "${argument}" as a time. Use 20:00, +2h or 2026-08-02T20:00.`;
        }
        if (parsed <= now) return `"${argument}" has already passed.`;
        startsAt = parsed;
        continue;
      }

      const value = Number(argument);
      if (!Number.isFinite(value) || value <= 0) {
        return 'Duration is in minutes, e.g. for 120.';
      }
      minutes = value;
      continue;
    }

    if (minutes === undefined && startsAt === undefined && !words.length) {
      const value = Number(token);
      if (token !== '' && Number.isFinite(value) && value > 0) {
        minutes = value;
        continue;
      }
    }

    words.push(token);
  }

  // A duration given with a start time counts from the start: "Saturday at 8pm
  // for two hours" is two hours of event, not two hours from now.
  const base = startsAt ?? now;
  return {
    ...(startsAt !== undefined ? { startsAt } : {}),
    ...(minutes !== undefined ? { expiresAt: base + minutes * 60_000 } : {}),
    note: words.join(' ').trim(),
  };
}

function describeFlag(flag: LiveOpsFlag): string {
  const now = Date.now();
  const { startsAt, expiresAt } = flag;
  let window = '';
  if (startsAt !== undefined && startsAt > now) {
    window = `, starts in ${formatDuration(startsAt - now)}`;
    if (expiresAt !== undefined) {
      window += ` for ${formatDuration(expiresAt - startsAt)}`;
    }
  } else if (expiresAt !== undefined) {
    window = `, ${formatDuration(expiresAt - now)} left`;
  }
  const who = flag.setBy ? `, by ${flag.setBy}` : '';
  const note = flag.note ? ` - ${flag.note}` : '';
  return `${flag.name} = ${String(flag.value)}${window}${who}${note}`;
}

function onlinePlayerNames(): string[] {
  const names = new Set<string>();
  for (const map of Object.values(getRuntimeState().maps)) {
    for (const player of Object.values(map.players)) names.add(player.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

export function registerServerCommands(): void {
  registerCommand(
    'broadcast',
    { access: Access.MOD, description: 'Broadcast a message to everyone' },
    ({ args, reply }) => {
      const message = args.join(' ').trim();
      if (!message) return reply('Usage: broadcast <message>');
      handleChatAction({ type: 'chat', scope: 'global', message });
      reply('Broadcast sent.');
    },
  );

  const listPlayers = ({ reply }: { reply: (m: string) => void }) => {
    const names = onlinePlayerNames();
    reply(
      names.length
        ? `Online (${names.length}): ${names.join(', ')}`
        : 'No players online.',
    );
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

  registerCommand(
    'motd',
    { access: Access.ADMIN, description: 'Set the message of the day' },
    ({ args, reply }) => {
      serverState.motd = args.join(' ').trim();
      reply(
        serverState.motd ? `MOTD set: ${serverState.motd}` : 'MOTD cleared.',
      );
    },
  );

  registerCommand(
    'mode',
    {
      access: Access.ADMIN,
      description: 'Set server mode: normal | maintenance | gm_only',
    },
    ({ args, reply }) => {
      const mode = args[0] as ServerMode;
      if (mode !== 'normal' && mode !== 'maintenance' && mode !== 'gm_only') {
        return reply('Usage: mode <normal|maintenance|gm_only>');
      }
      serverState.mode = mode;
      reply(`Server mode is now: ${mode}`);
    },
  );

  registerCommand(
    'mute',
    {
      access: Access.ADMIN,
      description: 'Mute a player: mute <name> [minutes]',
    },
    ({ args, reply }) => {
      const name = args[0];
      if (!name) return reply('Usage: mute <name> [minutes]');
      const minutes = Number(args[1]);
      const expiry =
        Number.isFinite(minutes) && minutes > 0
          ? Date.now() + minutes * 60_000
          : 0;
      serverState.mutes.set(name, expiry);
      reply(`${name} muted${expiry ? ` for ${minutes}m` : ' permanently'}.`);
    },
  );

  registerCommand(
    'unmute',
    { access: Access.ADMIN, description: 'Unmute a player' },
    ({ args, reply }) => {
      const name = args[0];
      if (!name) return reply('Usage: unmute <name>');
      serverState.mutes.delete(name);
      reply(`${name} unmuted.`);
    },
  );

  // Live-ops, as a command so it reaches the operator from the terminal, the
  // web console and chat, and "who turned on double XP" is in the audit trail.
  registerCommand(
    'flag',
    {
      access: Access.ADMIN,
      description:
        'Live-ops flags: flag | flag <name> <value> [at <when>] [for <minutes>] [note] | flag <name> clear',
    },
    ({ args, reply, actor }) => {
      const [name, rawValue, ...rest] = args;

      if (!name) {
        const active = listFlags();
        if (!active.length) return reply('No live-ops flags are set.');
        for (const flag of active) reply(describeFlag(flag));
        return;
      }

      if (rawValue === undefined) {
        return reply(
          'Usage: flag <name> <value> [at <when>] [for <minutes>] [note] | flag <name> clear',
        );
      }

      if (rawValue === 'clear' || rawValue === 'off') {
        return clearFlag(name)
          .then((existed) =>
            reply(existed ? `Flag ${name} cleared.` : `No flag named ${name}.`),
          )
          .catch(() => reply('Could not clear the flag; see the server log.'));
      }

      const timing = parseFlagTiming(rest, Date.now());
      if (typeof timing === 'string') return reply(timing);

      return setFlag(name, parseFlagValue(rawValue), {
        ...(timing.startsAt !== undefined ? { startsAt: timing.startsAt } : {}),
        ...(timing.expiresAt !== undefined
          ? { expiresAt: timing.expiresAt }
          : {}),
        setBy: actor,
        ...(timing.note ? { note: timing.note } : {}),
      })
        .then((flag) => reply(`Flag set: ${describeFlag(flag)}`))
        .catch(() => reply('Could not set the flag; see the server log.'));
    },
  );

  // The operator surface for reconciliation: it runs from the dashboard
  // console and from in-game chat, and lands in the audit trail like any other
  // admin command, so "who checked the economy and when" is answerable too.
  registerCommand(
    'economy',
    {
      access: Access.ADMIN,
      description:
        'Count every item in the world and compare with the last count',
    },
    // Returns the promise rather than firing and forgetting: the web console
    // waits for it, and a dropped reply would leave "Counting..." on the
    // operator's screen forever.
    ({ reply }) =>
      runCensus()
        .then(({ census, deltas }) => {
          const distinct = census.items.length;
          const totals = census.items.reduce((sum, i) => sum + i.total, 0);
          reply(
            `${totals} items of ${distinct} kinds across ${census.players} players.`,
          );

          if (deltas.length === 0) {
            return reply('No change since the previous count.');
          }

          const flagged = deltas.filter(isSuspicious);
          for (const delta of (flagged.length ? flagged : deltas).slice(0, 5)) {
            const who = delta.topHolders
              .map((h) => `${h.name} x${h.quantity}`)
              .join(', ');
            reply(
              `item ${delta.itemId}: ${delta.before} -> ${delta.after} ` +
                `(${delta.change > 0 ? '+' : ''}${delta.change})` +
                (who ? ` | top: ${who}` : ''),
            );
          }
          if (flagged.length) {
            reply(`${flagged.length} above the alert threshold.`);
          }
        })
        .catch(() => reply('Census failed; see the server log.')),
  );
}
