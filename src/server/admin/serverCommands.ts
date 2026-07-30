import { registerCommand } from '../engine/commands.js';
import { isSuspicious, runCensus } from '../services/economy/censusJob.js';
import { Access } from '../../shared/types.js';
import { serverState, type ServerMode } from '../services/world/serverState.js';
import { handleChatAction } from '../services/comms/chatService.js';
import { getGameState } from '../services/gameService.js';

// Server-wide ops as registry commands, so they work from the web console
// and in-game chat, access-gated. The terminal REPL matches its own richer
// built-ins first, so these never shadow it. Registered once at boot.

function onlinePlayerNames(): string[] {
  const names = new Set<string>();
  for (const map of Object.values(getGameState().maps)) {
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
