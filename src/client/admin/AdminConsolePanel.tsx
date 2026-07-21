import React, { useEffect, useRef, useState } from 'react';
import {
  fetchCommands,
  runConsoleCommand,
  type CommandInfo,
} from '../io/network';
import { colors, radius } from '../theme';

type Line = { kind: 'in' | 'out'; text: string };

// Inline command console for the dashboard: it runs registered commands
// (server ops, script and module commands) and cannot evaluate arbitrary
// code outside that registry.
export const AdminConsolePanel: React.FC = () => {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const history = useRef<string[]>([]);
  const idx = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchCommands()
      .then(setCommands)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const submit = async () => {
    const line = input.trim();
    if (!line) return;
    setLines((l) => [...l, { kind: 'in', text: line }]);
    history.current.push(line);
    idx.current = history.current.length;
    setInput('');
    try {
      const out = await runConsoleCommand(line);
      setLines((l) => [
        ...l,
        ...(out.length ? out : ['(no output)']).map((text) => ({
          kind: 'out' as const,
          text,
        })),
      ]);
    } catch (e: unknown) {
      const msg = (e as { message?: string })?.message ?? 'Command failed.';
      setLines((l) => [...l, { kind: 'out', text: msg }]);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void submit();
    else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx.current > 0) {
        idx.current -= 1;
        setInput(history.current[idx.current] ?? '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx.current < history.current.length - 1) {
        idx.current += 1;
        setInput(history.current[idx.current] ?? '');
      } else {
        idx.current = history.current.length;
        setInput('');
      }
    }
  };

  return (
    <section style={panel}>
      <h2 style={title}>Console</h2>
      <div ref={logRef} style={log}>
        {lines.length === 0 ? (
          <p style={hint}>
            Run a command, e.g. <code style={code}>players</code>,{' '}
            <code style={code}>broadcast Hello</code>,{' '}
            <code style={code}>mode maintenance</code>.
          </p>
        ) : (
          lines.map((l, i) => (
            <div key={i} style={l.kind === 'in' ? lineIn : lineOut}>
              {l.kind === 'in' ? `> ${l.text}` : l.text}
            </div>
          ))
        )}
      </div>
      {commands.length > 0 && (
        <div style={cmdHint}>{commands.map((c) => c.name).join('  ')}</div>
      )}
      <div style={inputRow}>
        <span style={prompt}>›</span>
        <input
          style={inputBox}
          value={input}
          spellCheck={false}
          autoComplete="off"
          placeholder="type a command and press Enter"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </section>
  );
};

const mono =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const panel: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const title: React.CSSProperties = { margin: 0, fontSize: 16 };
const log: React.CSSProperties = {
  height: 260,
  overflowY: 'auto',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: 10,
  fontFamily: mono,
  fontSize: 13,
  lineHeight: 1.5,
  background: colors.surfaceMuted,
};
const hint: React.CSSProperties = { color: colors.textMuted, margin: 0 };
const code: React.CSSProperties = {
  background: colors.surface,
  padding: '1px 5px',
  borderRadius: radius.sm,
};
const lineIn: React.CSSProperties = {
  color: colors.primary,
  whiteSpace: 'pre-wrap',
};
const lineOut: React.CSSProperties = {
  color: colors.text,
  whiteSpace: 'pre-wrap',
};
const cmdHint: React.CSSProperties = {
  fontSize: 11,
  color: colors.textMuted,
  whiteSpace: 'nowrap',
  overflowX: 'auto',
};
const inputRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: '6px 10px',
};
const prompt: React.CSSProperties = { color: colors.primary, fontWeight: 700 };
const inputBox: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: colors.text,
  fontSize: 13,
  fontFamily: mono,
};
