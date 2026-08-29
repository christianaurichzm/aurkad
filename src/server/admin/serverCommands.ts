import { registerCommand } from '../engine/commands.js';
import { isSuspicious, runCensus } from '../services/economy/economyCensus.js';
import { Access } from '../../shared/types.js';
import { serverState, type ServerMode } from '../services/world/serverState.js';
import { getChatLog, handleChatAction } from '../services/comms/chatService.js';
import { publishToInstances } from '../persistence/instanceBus.js';
import { getRuntimeState } from '../services/world/gameData.js';
import { getMetrics } from '../metrics.js';
import { config } from '../config.js';
import {
  dailyActivity,
  funnel,
  retention,
} from '../services/analyticsService.js';
import {
  listReplays,
  recordingStatus,
  saveReplay,
  startRecording,
  stopRecording,
} from '../sim/replayRecorder.js';
import {
  clearFlag,
  listFlags,
  setFlag,
  type FlagValue,
  type LiveOpsFlag,
} from '../services/liveOpsService.js';

// Server-wide ops as registry commands: one implementation, reached from the
// terminal, the web console and in-game chat alike, and audited through the one
// dispatcher all three cross. Registered once at boot; the player-subject half
// is in playerCommands.ts.

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

/**
 * One line of an analytics table, header included, so a column added to one
 * is added to both.
 */
const COLUMNS = [12, 9, 12, 12, 12];

const row = (values: string[]): string =>
  '  ' +
  values
    .map((value, i) =>
      i === 0
        ? value.padEnd(COLUMNS[i] ?? 12)
        : value.padStart(COLUMNS[i] ?? 12),
    )
    .join('');

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

export function registerServerCommands(): void {
  registerCommand(
    'broadcast',
    { access: Access.MOD, description: 'Broadcast a message to everyone' },
    ({ args, reply, style }) => {
      const message = args.join(' ').trim();
      if (!message) return reply('Usage: broadcast <message>');
      // Through the chat service, not straight at the sockets: that is what
      // records the line in the chat log, so `chat` can show the announcement
      // that was just made.
      handleChatAction({ type: 'chat', scope: 'global', message });
      reply(style.ok(`Broadcast sent: ${message}`));
    },
  );
  registerCommand(
    'say',
    { access: Access.MOD, description: 'Broadcast a message to everyone' },
    ({ args, reply, style }) => {
      const message = args.join(' ').trim();
      if (!message) return reply('Usage: say <message>');
      handleChatAction({ type: 'chat', scope: 'global', message });
      reply(style.ok(`Broadcast sent: ${message}`));
    },
  );

  registerCommand(
    'maps',
    { access: Access.MOD, description: 'List active maps and entity counts' },
    ({ reply, style }) => {
      const entries = Object.entries(getRuntimeState().maps);
      if (entries.length === 0) return reply(style.warn('No active maps.'));

      reply(
        `${style.title('Active maps')}: ${style.value(String(entries.length))}`,
      );
      for (const [mapId, map] of entries) {
        const players = Object.keys(map.players).length;
        const npcs = Object.keys(map.npcs).length;
        reply(
          `  ${style.map(mapId.padEnd(20))} players:${style.value(String(players))}  npcs:${style.value(String(npcs))}`,
        );
      }
    },
  );

  registerCommand(
    'chat',
    { access: Access.MOD, description: 'Show the last n chat messages' },
    ({ args, reply, style }) => {
      const asked = args[0] ? parseInt(args[0], 10) : 20;
      const entries = getChatLog(isNaN(asked) ? 20 : asked);
      if (entries.length === 0) {
        return reply(style.warn('No chat messages yet.'));
      }
      for (const entry of entries) {
        const at = new Date(entry.ts).toLocaleTimeString();
        reply(
          `  ${style.muted(`[${at}]`)} ${style.value(`[${entry.scope}]`)} ${style.player(entry.username ?? '[server]')}: ${entry.message}`,
        );
      }
    },
  );

  registerCommand(
    'stats',
    { access: Access.ADMIN, description: 'Show server metrics' },
    ({ reply, style }) => {
      const m = getMetrics();
      reply(
        `${style.title('Uptime')}: ${style.value(`${m.uptime}s`)}  |  WS: ${style.value(String(m.wsConnections))}  |  Players: ${style.value(String(m.players))}  |  NPCs: ${style.value(String(m.npcs))}  |  Maps: ${style.value(String(m.maps))}`,
      );
      reply(
        `${style.title('Tick')}: avg ${style.value(`${m.tick.avgMs}ms`)}  p50 ${style.value(`${m.tick.p50Ms}ms`)}  p95 ${style.value(`${m.tick.p95Ms}ms`)}  p99 ${style.value(`${m.tick.p99Ms}ms`)}  max ${style.value(`${m.tick.maxMs}ms`)}  (${m.tick.samples} samples)`,
      );
      reply(
        `${style.title('Queue')}: avg ${style.value(String(m.tick.avgQueueSize))}  p95 ${style.value(String(m.tick.p95QueueSize))}  max ${style.value(String(m.tick.maxQueueSize))}  |  ${style.title('Catch-up')}: ${style.value(String(m.tick.catchUpTicks))} of ${style.value(String(m.tick.totalTicks))} ticks`,
      );
      // Right under the tick line, because "it got slower" and "this file is
      // why" are one question. Silent until a window has closed.
      if (m.scripts.shares.length > 0) {
        const top = m.scripts.shares
          .slice(0, 3)
          .map(
            (s) => `${style.player(s.script)} ${style.value(`${s.percent}%`)}`,
          )
          .join('  ');
        reply(
          `${style.title('Scripts')}: ${top}  ${style.muted('(last window)')}`,
        );
      }
    },
  );

  registerCommand(
    'motd',
    {
      access: Access.ADMIN,
      description: 'Get, set or clear the message of the day',
    },
    ({ args, reply, style }) => {
      // A bare `motd` reads it, the same as in the terminal, so the one word
      // never wipes the notice on one surface and prints it on another.
      if (args.length === 0) {
        return reply(
          serverState.motd
            ? `${style.title('MOTD')}: ${serverState.motd}`
            : style.warn('No MOTD set.'),
        );
      }
      if (args[0] === 'clear') {
        serverState.motd = '';
        publishToInstances('motd', { text: '' });
        return reply(style.ok('MOTD cleared.'));
      }
      serverState.motd = args.join(' ').trim();
      publishToInstances('motd', { text: serverState.motd });
      reply(style.ok(`MOTD set: ${serverState.motd}`));
    },
  );

  registerCommand(
    'mode',
    {
      access: Access.ADMIN,
      description: 'Get or set server mode: normal | maintenance | gm_only',
    },
    ({ args, reply, style }) => {
      const mode = args[0] as ServerMode | undefined;
      if (!mode) {
        return reply(
          `${style.title('Server mode')}: ${style.value(serverState.mode)}`,
        );
      }
      if (mode !== 'normal' && mode !== 'maintenance' && mode !== 'gm_only') {
        return reply('Usage: mode [normal|maintenance|gm_only]');
      }
      serverState.mode = mode;
      // The mode decides who may log in, and a login can arrive at any
      // instance: a maintenance half the fleet has not heard of is no
      // maintenance at all.
      publishToInstances('mode', { mode });
      reply(style.ok(`Server mode set to: ${mode}`));
      // Players find out from the game, not from the log: the modes that
      // restrict logins are the ones somebody is about to run into.
      if (mode !== 'normal') {
        handleChatAction({
          type: 'chat',
          scope: 'global',
          message:
            mode === 'maintenance'
              ? 'Server entering maintenance mode. New logins are restricted.'
              : 'Server is now GM-only. New logins are restricted.',
        });
      }
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

  // Session recording, as a command: REPLAY_RECORD is read only at boot, and
  // restarting during an incident ends the session you wanted to see.
  registerCommand(
    'replay',
    {
      access: Access.ADMIN,
      description:
        'Session recording: replay | replay start [label] | replay save [label] | replay stop | replay list',
    },
    ({ args, reply, style }) => {
      const [sub, ...rest] = args;
      const label = rest.join(' ').trim();

      if (!sub || sub === 'status') {
        const status = recordingStatus();
        if (!status.recording && status.events === 0) {
          return reply(style.warn('Not recording. Start with: replay start'));
        }
        const filled = Math.round((status.events / status.capacity) * 100);
        return reply(
          `${style.title('Replay')}: ${status.recording ? style.ok('recording') : style.warn('stopped')}` +
            `${status.label ? ` (${status.label})` : ''} since ${status.startedAt}, ` +
            `${style.value(String(status.events))} actions (${filled}% of ${status.capacity})` +
            (status.dropped
              ? `, ${style.warn(`${status.dropped} dropped`)}`
              : ''),
        );
      }

      if (sub === 'start') {
        startRecording(label || undefined);
        return reply(
          style.ok(
            `Recording started${label ? ` (${label})` : ''}. Save it with: replay save`,
          ),
        );
      }

      if (sub === 'save' || sub === 'stop') {
        // Save keeps the capture running: whoever noticed something at 20:03
        // usually wants the minutes after it too.
        const path = saveReplay(label || undefined);
        if (sub === 'stop') stopRecording();
        if (!path) {
          return reply(
            style.warn(
              `Nothing buffered; no file written${sub === 'stop' ? ', recording stopped.' : '.'}`,
            ),
          );
        }
        return reply(
          style.ok(
            `Saved ${path} (${sub === 'stop' ? 'recording stopped' : 'still recording'}).` +
              ` Read it with: npm run replay -- ${path}`,
          ),
        );
      }

      if (sub === 'list') {
        const files = listReplays();
        if (files.length === 0)
          return reply(style.warn('No recordings saved.'));
        for (const file of files.slice(0, 20)) {
          reply(
            `  ${style.value(file.name)}  ${Math.round(file.bytes / 1024)} KB  ${new Date(
              file.savedAt,
            ).toLocaleString()}`,
          );
        }
        // Read them with `npm run replay -- <file>`; the server only writes.
        return;
      }

      reply(
        'Usage: replay | replay start [label] | replay save [label] | replay stop | replay list',
      );
    },
  );

  /**
   * The three questions a patch raises, as subcommands of one command: how
   * many are here, did the new ones stay, where do people fall out. They read
   * the same rows, and an operator who remembers one name finds the others.
   */
  registerCommand(
    'analytics',
    {
      access: Access.ADMIN,
      description:
        'Player activity: analytics [days] | analytics retention [cohorts] | analytics funnel [days] [level]',
    },
    async ({ args, reply, style }) => {
      if (!config.analytics.enabled) {
        return reply(
          style.warn(
            'Analytics is off (ANALYTICS_ENABLED=false); nothing is being recorded.',
          ),
        );
      }

      const mode =
        args[0] === 'retention' || args[0] === 'funnel' ? args[0] : 'days';
      const asNumber = (raw: string | undefined, fallback: number) => {
        const value = raw ? parseInt(raw, 10) : NaN;
        return Number.isFinite(value) && value > 0 ? value : fallback;
      };

      if (mode === 'retention') {
        const rows = await retention(asNumber(args[1], 14));
        if (rows.length === 0) return reply(style.warn('No cohorts yet.'));

        reply(
          `${style.title('Retention')} ${style.muted('(of the players who arrived that day, how many came back)')}`,
        );
        reply(style.muted(row(['cohort', 'arrived', 'd1', 'd7', 'd30'])));
        for (const cohort of rows) {
          // Count and share together: the share is what compares two cohorts,
          // and the count is what says whether the share means anything.
          const share = (mark: number) => {
            const n = cohort.returned[mark] ?? 0;
            return cohort.players === 0
              ? '-'
              : `${n} (${Math.round((n / cohort.players) * 100)}%)`;
          };
          reply(
            row([
              cohort.cohort,
              String(cohort.players),
              ...[1, 7, 30].map(share),
            ]),
          );
        }
        return;
      }

      if (mode === 'funnel') {
        const days = asNumber(args[1], 30);
        const level = asNumber(args[2], 5);
        const f = await funnel(days, level);
        // Each step against the one above it: the drop between two steps is
        // the number worth acting on, and a share of the top hides which drop.
        const step = (label: string, value: number, previous: number) =>
          reply(
            `  ${label.padEnd(24)}${String(value).padStart(8)}` +
              (previous > 0
                ? style.muted(
                    `  ${Math.round((value / previous) * 100)}% of the step above`,
                  )
                : ''),
          );

        reply(
          `${style.title('Funnel')} ${style.muted(`accounts made ${f.from} to ${f.to}`)}`,
        );
        step('registered', f.registered, 0);
        step('played at least once', f.played, f.registered);
        step('came back another day', f.returned, f.played);
        step(`reached level ${f.level}`, f.reachedLevel, f.registered);
        return;
      }

      const rows = await dailyActivity(asNumber(args[0], 14));
      if (rows.length === 0) {
        return reply(style.warn('Nobody has played in that window.'));
      }

      reply(style.title('Daily active players'));
      reply(style.muted(row(['day', 'players', 'new', 'sessions', 'minutes'])));
      for (const day of rows) {
        reply(
          row([
            day.day,
            String(day.players),
            String(day.newPlayers),
            String(day.sessions),
            String(day.minutes),
          ]),
        );
      }
      const busiest = rows.reduce((a, b) => (b.players > a.players ? b : a));
      reply(
        style.muted(
          `  busiest: ${busiest.day} with ${busiest.players} players`,
        ),
      );
    },
  );

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
