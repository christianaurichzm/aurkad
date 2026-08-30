import { emitGameEvent } from './eventBus.js';
import { registerStrings, translate } from './i18n.js';
import { logger } from '../logger.js';
import { recordAdminAction } from '../services/auditService.js';
import { getPlayerByName } from '../sim/world.js';
import { leaseHolderOf } from '../persistence/presence.js';
import { publishToInstances } from '../persistence/instanceBus.js';
import { Access } from '../../shared/types.js';
import type { PlayerServer } from '../../shared/types.js';

// Command registry: game/module scripts register named commands that the engine
// routes from BOTH in-game chat (/name args) and the terminal REPL (name args).
// Chat enforces the access level AND an optional canRun predicate (e.g. a VIP
// flag that isn't an access tier); the REPL operator bypasses both.

/**
 * How a surface wants a reply emphasised. The terminal speaks ANSI, while the
 * browser console and chat would print the codes as garbage, so a handler
 * asks for emphasis by role and the surface decides. The default does nothing.
 */
export interface CommandStyle {
  title: (text: string) => string;
  player: (text: string) => string;
  map: (text: string) => string;
  ok: (text: string) => string;
  warn: (text: string) => string;
  error: (text: string) => string;
  muted: (text: string) => string;
  value: (text: string) => string;
}

const asIs = (text: string) => text;

export const plainStyle: CommandStyle = {
  title: asIs,
  player: asIs,
  map: asIs,
  ok: asIs,
  warn: asIs,
  error: asIs,
  muted: asIs,
  value: asIs,
};

export interface CommandContext {
  // Present when invoked from chat; absent when invoked from the REPL.
  player?: PlayerServer;
  args: string[];
  reply: (message: string) => void;
  style: CommandStyle;
  source: 'chat' | 'repl' | 'web';
  /**
   * Who is running this, resolved by the dispatcher: the player's name from
   * chat, the session's account from the web console, or "console" for the
   * terminal. The same string the audit trail records, so a command that
   * stores who changed something agrees with the trail.
   */
  actor: string;
}

/** What an entry point builds; the dispatcher resolves the rest. */
type IncomingCommand = Omit<CommandContext, 'actor' | 'style'> & {
  style?: CommandStyle;
};

/**
 * A handler may be async, and a caller that can wait should. The web console
 * serialises the replies into one response, so a reply after the first await,
 * as from a command that reads the database, would be lost otherwise.
 */
export type CommandResult = void | Promise<void>;

export interface CommandOptions {
  access?: Access; // minimum access for CHAT invocation (REPL bypasses)
  description?: string;
  // Extra gate for chat, on top of access (the REPL bypasses it), for player
  // state that is not an access tier, e.g. a VIP flag:
  // canRun: (p) => getPlayerData(p, 'vip') === true.
  canRun?: (player: PlayerServer) => boolean;
  /**
   * The command acts on a live character named by its first argument, so under
   * sharding it has to reach the process that owns the account. See
   * `forwardToOwner`. A command that only reads, or that answers about a name
   * rather than a character (kick, mute, ban), does not want this.
   */
  forwardable?: boolean;
}

interface CommandDef {
  name: string;
  access: Access;
  description: string;
  canRun?: (player: PlayerServer) => boolean;
  forwardable: boolean;
  handler: (ctx: CommandContext) => CommandResult;
}

// The engine's own answers, in the same table the modules write into: a player
// who mistypes a command should not read English between two Portuguese lines.
registerStrings({
  pt: {
    'Command error.': 'Erro no comando.',
    'Unknown command: /{name}': 'Comando desconhecido: /{name}',
    "You don't have permission to use /{name}.":
      'Você não tem permissão para usar /{name}.',
  },
});

const commands = new Map<string, CommandDef>();

export function registerCommand(
  name: string,
  options: CommandOptions,
  handler: (ctx: CommandContext) => CommandResult,
): () => void {
  const key = name.toLowerCase();
  // Last registration wins, so a game can override an engine command; the
  // warning keeps it from going unnoticed. Scripts unregister before a
  // reload, so a hot reload does not trip it.
  if (commands.has(key)) {
    logger.warn(
      `[command] "${key}" was already registered; the earlier one is now unreachable`,
    );
  }
  commands.set(key, {
    name: key,
    access: options.access ?? Access.USER,
    description: options.description ?? '',
    canRun: options.canRun,
    forwardable: options.forwardable ?? false,
    handler,
  });
  return () => {
    if (commands.get(key)?.handler === handler) commands.delete(key);
  };
}

export function listCommands(): ReadonlyArray<
  Pick<CommandDef, 'name' | 'access' | 'description'>
> {
  return [...commands.values()].map(({ name, access, description }) => ({
    name,
    access,
    description,
  }));
}

export function clearCommands(): void {
  commands.clear();
}

/**
 * Leaves a trail for commands that ordinary players cannot run.
 *
 * A GM kicks or hands out an item from chat far more often than from an HTTP
 * route, so auditing only the routes would miss the common case. Commands
 * anyone can run are not recorded: /who is not an administrative action, and
 * burying the log in them defeats it.
 */
function auditCommand(
  cmd: CommandDef,
  ctx: CommandContext,
  actor: string,
): void {
  if (cmd.access < Access.MOD) return;
  recordAdminAction({
    actor,
    actorAccess: ctx.player?.access,
    requiredAccess: cmd.access,
    action: `command ${cmd.name}`,
    // First argument, because every privileged command takes its subject
    // there (/kick <player>, /ban <player>, /give <player> ...).
    target: ctx.args[0],
    outcome: 'allowed',
    source: ctx.source,
    details: ctx.args.length > 0 ? { args: ctx.args.join(' ') } : undefined,
  });
}

/**
 * Runs a command whose subject is logged in on another instance. Sharding
 * splits the fleet by map, so the character may be in another process's
 * memory. Whoever holds the account lease can write the character, so the
 * command is republished for that instance's dispatcher. Access was checked
 * at the origin: the receiver has no session, and the bus is internal.
 */
async function forwardToOwner(
  cmd: CommandDef,
  ctx: CommandContext,
  actor: string,
  target: string,
): Promise<void> {
  const holder = await leaseHolderOf(target);
  if (!holder) {
    // Offline everywhere, or a single process: the handler's own refusal is
    // the true answer, and it is the one the operator should read.
    await cmd.handler(ctx);
    return;
  }

  publishToInstances('playerCommand', {
    command: cmd.name,
    args: ctx.args,
    actor,
    source: ctx.source,
  });
  ctx.reply(`${target} is on another instance; ${cmd.name} sent there.`);
}

function runHandler(
  cmd: CommandDef,
  incoming: IncomingCommand,
  // Chat carries the player; the web console knows its session; the terminal
  // has no account behind it, which is itself worth recording as such.
  actor = incoming.player?.name ?? 'console',
  // False for a command that already crossed the bus. Leases read moments
  // apart can name a third instance while a player warps, and one hop has an
  // end where a chase does not.
  mayForward = true,
): CommandResult {
  const ctx: CommandContext = {
    ...incoming,
    style: incoming.style ?? plainStyle,
    actor,
  };
  auditCommand(cmd, ctx, actor);
  const failed = (e: unknown) => {
    logger.error(`[command] "${cmd.name}" threw`, { err: e });
    ctx.reply(translate(ctx.player, 'Command error.'));
  };

  const target = ctx.args[0];
  if (mayForward && cmd.forwardable && target && !getPlayerByName(target)) {
    return forwardToOwner(cmd, ctx, actor, target).catch(failed);
  }

  try {
    return Promise.resolve(cmd.handler(ctx)).catch(failed);
  } catch (e) {
    failed(e);
    return undefined;
  }
}

/**
 * The other end of `forwardToOwner`. Replies go nowhere, as the operator
 * already read that it was sent; a character that logged out meanwhile is
 * refused into that same void.
 */
export function runForwardedCommand(payload: {
  command: string;
  args: string[];
  actor: string;
  source: CommandContext['source'];
}): void {
  const cmd = commands.get(payload.command);
  if (!cmd) return;

  void runHandler(
    cmd,
    { args: payload.args, reply: () => {}, source: payload.source },
    payload.actor,
    false,
  );
}

// Chat entry point. Returns true if the message was a command attempt, so the
// caller suppresses the normal chat broadcast. Replies privately to the player.
export function handleChatCommand(
  player: PlayerServer,
  message: string,
): boolean {
  if (!message.startsWith('/')) return false;
  const parts = message.slice(1).trim().split(/\s+/);
  const name = parts[0]?.toLowerCase() ?? '';
  if (!name) return false; // a lone "/" is ordinary chat

  // Every chat reply crosses here, which is why the translation is here and
  // not in each command: a handler returns the English it was written with,
  // and the player reads it in the language their client asked for. A sentence
  // nobody translated is the English, unchanged.
  const reply = (text: string) =>
    emitGameEvent({
      type: 'chatPlayer',
      username: player.name,
      payload: {
        type: 'chat',
        scope: 'player',
        message: translate(player, text),
      },
    });

  const cmd = commands.get(name);
  if (!cmd) {
    reply(translate(player, 'Unknown command: /{name}', { name }));
    return true;
  }
  if (
    (player.access ?? 0) < cmd.access ||
    (cmd.canRun && !cmd.canRun(player))
  ) {
    reply(
      translate(player, "You don't have permission to use /{name}.", { name }),
    );
    return true;
  }
  void runHandler(cmd, { player, args: parts.slice(1), reply, source: 'chat' });
  return true;
}

/**
 * REPL entry point. The operator is trusted, so access is bypassed. Returns
 * true if a command matched (so the REPL doesn't print "unknown command").
 *
 * Awaited for the same reason the web console awaits: a handler that reads the
 * database replies after its first await, and the terminal would otherwise
 * redraw the prompt over the answer.
 */
export async function handleReplCommand(
  name: string,
  args: string[],
  out: (message: string) => void,
  style?: CommandStyle,
): Promise<boolean> {
  const cmd = commands.get(name.toLowerCase());
  if (!cmd) return false;
  await runHandler(cmd, {
    args,
    reply: out,
    source: 'repl',
    ...(style && { style }),
  });
  return true;
}

/**
 * Web console entry point: like the REPL, but the command's access level is
 * checked against the caller's, as a web session is trusted less than the
 * terminal. Async so the caller can await handlers that read the database.
 */
export async function handleWebCommand(
  name: string,
  args: string[],
  accessLevel: Access,
  out: (message: string) => void,
  actor?: string,
): Promise<boolean> {
  const cmd = commands.get(name.toLowerCase());
  if (!cmd) return false;
  if (accessLevel < cmd.access) {
    recordAdminAction({
      actor,
      actorAccess: accessLevel,
      requiredAccess: cmd.access,
      action: `command ${cmd.name}`,
      target: args[0],
      outcome: 'denied',
      source: 'web',
    });
    out(`You don't have permission to run "${name}".`);
    return true;
  }
  await runHandler(cmd, { args, reply: out, source: 'web' }, actor);
  return true;
}
