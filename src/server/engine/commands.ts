import { emitGameEvent } from './eventBus.js';
import { logger } from '../logger.js';
import { Access } from '../../shared/types.js';
import type { PlayerServer } from '../../shared/types.js';

// Command registry: game/module scripts register named commands that the engine
// routes from BOTH in-game chat (/name args) and the terminal REPL (name args).
// The engine enforces the access level for chat; the REPL operator bypasses it.

export interface CommandContext {
  // Present when invoked from chat; absent when invoked from the REPL.
  player?: PlayerServer;
  args: string[];
  reply: (message: string) => void;
  source: 'chat' | 'repl';
}

export interface CommandOptions {
  access?: Access; // minimum access for CHAT invocation (REPL bypasses)
  description?: string;
}

interface CommandDef {
  name: string;
  access: number;
  description: string;
  handler: (ctx: CommandContext) => void;
}

const commands = new Map<string, CommandDef>();

export function registerCommand(
  name: string,
  options: CommandOptions,
  handler: (ctx: CommandContext) => void,
): () => void {
  const key = name.toLowerCase();
  commands.set(key, {
    name: key,
    access: options.access ?? Access.USER,
    description: options.description ?? '',
    handler,
  });
  return () => {
    if (commands.get(key)?.handler === handler) commands.delete(key);
  };
}

export function listCommands(): ReadonlyArray<Pick<CommandDef, 'name' | 'access' | 'description'>> {
  return [...commands.values()].map(({ name, access, description }) => ({
    name,
    access,
    description,
  }));
}

export function clearCommands(): void {
  commands.clear();
}

function runHandler(cmd: CommandDef, ctx: CommandContext): void {
  try {
    cmd.handler(ctx);
  } catch (e) {
    logger.error(`[command] "${cmd.name}" threw`, { err: e });
    ctx.reply('Command error.');
  }
}

// Chat entry point. Returns true if the message was a command attempt, so the
// caller suppresses the normal chat broadcast. Replies privately to the player.
export function handleChatCommand(player: PlayerServer, message: string): boolean {
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
  if ((player.access ?? 0) < cmd.access) {
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
