import { emitGameEvent } from './eventBus.js';
import { logger } from '../logger.js';
import { recordAdminAction } from '../services/auditService.js';
import { Access } from '../../shared/types.js';
import type { PlayerServer } from '../../shared/types.js';

// Command registry: game/module scripts register named commands that the engine
// routes from BOTH in-game chat (/name args) and the terminal REPL (name args).
// Chat enforces the access level AND an optional canRun predicate (e.g. a VIP
// flag that isn't an access tier); the REPL operator bypasses both.

export interface CommandContext {
  // Present when invoked from chat; absent when invoked from the REPL.
  player?: PlayerServer;
  args: string[];
  reply: (message: string) => void;
  source: 'chat' | 'repl' | 'web';
}

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
}

interface CommandDef {
  name: string;
  access: number;
  description: string;
  canRun?: (player: PlayerServer) => boolean;
  handler: (ctx: CommandContext) => CommandResult;
}

const commands = new Map<string, CommandDef>();

export function registerCommand(
  name: string,
  options: CommandOptions,
  handler: (ctx: CommandContext) => CommandResult,
): () => void {
  const key = name.toLowerCase();
  commands.set(key, {
    name: key,
    access: options.access ?? Access.USER,
    description: options.description ?? '',
    canRun: options.canRun,
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

function runHandler(
  cmd: CommandDef,
  ctx: CommandContext,
  // Chat carries the player; the web console knows its session; the terminal
  // has no account behind it, which is itself worth recording as such.
  actor = ctx.player?.name ?? 'console',
): CommandResult {
  auditCommand(cmd, ctx, actor);
  const failed = (e: unknown) => {
    logger.error(`[command] "${cmd.name}" threw`, { err: e });
    ctx.reply('Command error.');
  };
  try {
    return Promise.resolve(cmd.handler(ctx)).catch(failed);
  } catch (e) {
    failed(e);
    return undefined;
  }
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

  const reply = (text: string) =>
    emitGameEvent({
      type: 'chatPlayer',
      username: player.name,
      payload: { type: 'chat', scope: 'player', message: text },
    });

  const cmd = commands.get(name);
  if (!cmd) {
    reply(`Unknown command: /${name}`);
    return true;
  }
  if (
    (player.access ?? 0) < cmd.access ||
    (cmd.canRun && !cmd.canRun(player))
  ) {
    reply(`You don't have permission to use /${name}.`);
    return true;
  }
  runHandler(cmd, { player, args: parts.slice(1), reply, source: 'chat' });
  return true;
}

// REPL entry point. The operator is trusted, so access is bypassed. Returns
// true if a command matched (so the REPL doesn't print "unknown command").
export function handleReplCommand(
  name: string,
  args: string[],
  out: (message: string) => void,
): boolean {
  const cmd = commands.get(name.toLowerCase());
  if (!cmd) return false;
  runHandler(cmd, { args, reply: out, source: 'repl' });
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
  accessLevel: number,
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
