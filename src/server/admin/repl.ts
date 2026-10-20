import readline from 'node:readline';
import { styleText } from 'node:util';
import { Access } from '../../shared/types.js';
import {
  handleReplCommand,
  listCommands,
  type CommandStyle,
} from '../engine/commands.js';
import { serverState } from '../services/serverState.js';

/**
 * The server terminal: readline, colour and the prompt. Commands live in the
 * registry (serverCommands.ts, playerCommands.ts), which the web console and
 * chat use too, so a command acts the same everywhere and is audited. Colour
 * reaches handlers as a style, as the browser and chat would print ANSI codes
 * as garbage. `help` and tab completion read the registry as well.
 */

const COLOR_ENABLED = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(text: string, format: Parameters<typeof styleText>[0]): string {
  return COLOR_ENABLED
    ? styleText(format, text, { validateStream: false })
    : text;
}

const style: CommandStyle = {
  title: (text) => paint(text, ['bold', 'cyan']),
  player: (text) => paint(text, ['bold', 'magenta']),
  map: (text) => paint(text, 'blue'),
  ok: (text) => paint(text, 'green'),
  warn: (text) => paint(text, 'yellow'),
  error: (text) => paint(text, 'red'),
  muted: (text) => paint(text, 'gray'),
  value: (text) => paint(text, 'bold'),
};

const accessLabel: Record<Access, string> = {
  [Access.USER]: '',
  [Access.MOD]: 'mod',
  [Access.ADMIN]: 'admin',
};

const LOCAL_COMMANDS = ['help', '?', 'exit', 'quit', 'q'];

function out(line: string) {
  process.stdout.write(line + '\n');
}

function prompt(): string {
  const modeColor =
    serverState.mode === 'normal'
      ? 'green'
      : serverState.mode === 'maintenance'
        ? 'yellow'
        : 'magenta';

  return `${paint('admin', ['bold', 'cyan'])}:${paint(serverState.mode, ['bold', modeColor])}> `;
}

/**
 * Every registered command, widest name first so the descriptions line up,
 * read from the registry so script and module commands are listed too.
 */
function printHelp() {
  const commands = [...listCommands()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  const width = commands.reduce((w, c) => Math.max(w, c.name.length), 0);

  out('');
  out(style.title('Commands'));
  for (const command of commands) {
    const level = accessLabel[command.access] ?? '';
    out(
      `  ${style.value(command.name.padEnd(width))}  ${command.description}${
        level ? ` ${style.muted(`(${level})`)}` : ''
      }`,
    );
  }
  out('');
  out(
    `  ${style.value('help | ?'.padEnd(width))}  show this message`.replace(
      /\s+$/,
      '',
    ),
  );
  out(`  ${style.value('exit | quit'.padEnd(width))}  close the console`);
  out('');
}

export function startAdminRepl(): void {
  if (!process.stdin.isTTY) return;

  const completions = () => [
    ...listCommands().map((command) => command.name),
    ...LOCAL_COMMANDS,
  ];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: prompt(),
    terminal: true,
    completer: (line: string) => {
      const all = completions();
      const hits = all.filter((command) => command.startsWith(line));
      return [hits.length ? hits : all, line];
    },
  });

  out(style.ok('Admin console ready.'));
  out(
    `${style.muted('Type')} ${style.value('help')} ${style.muted('for commands. Press Tab to complete command names.')}`,
  );
  rl.prompt();

  const runLine = async (line: string) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0] ?? '';
    const args = parts.slice(1);

    try {
      if (cmd === 'help' || cmd === '?') {
        printHelp();
      } else if (cmd !== '') {
        // Awaited, unlike chat: a command that reads the database replies after
        // its first await, and the prompt must not be drawn over its output.
        const matched = await handleReplCommand(cmd, args, out, style);
        if (!matched) {
          out(style.error(`Unknown command: ${cmd}. Type 'help' for a list.`));
        }
      }
    } catch (err) {
      out(
        style.error(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }

    rl.setPrompt(prompt());
    rl.prompt();
  };

  // The listener stays synchronous: readline drops what it returns, so an
  // async one would send its rejection to Node's unhandled path and a typo
  // in the console would take the server down.
  rl.on('line', (line) => {
    const cmd = line.trim().split(/\s+/)[0];
    if (cmd === 'exit' || cmd === 'quit' || cmd === 'q') {
      out(style.warn('Admin console closed. Server still running.'));
      rl.close();
      return;
    }
    void runLine(line);
  });

  rl.on('close', () => {
    // stdin EOF, e.g. piped input finished; the server keeps running.
  });
}
