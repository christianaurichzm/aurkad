import React, { useEffect, useRef, useState } from 'react';
import { Access } from '../../shared/types';
import { useGame } from '../context/GameContext';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import {
  fetchCommands,
  runConsoleCommand,
  type CommandInfo,
} from '../io/network';
import { colors, radius } from '../theme';

type Line = { kind: 'in' | 'out'; text: string };

const isTyping = (): boolean => {
  const a = document.activeElement as HTMLElement | null;
  return (
    !!a &&
    (a.tagName === 'INPUT' ||
      a.tagName === 'TEXTAREA' ||
      a.isContentEditable === true)
  );
};

// Admin command console: runs registered commands from the browser, with
// no SSH. The backtick key or the Console action button toggles it, and it
// cannot evaluate arbitrary code outside the command registry.
export const AdminConsole: React.FC = () => {
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const access = livePlayer?.access ?? sessionPlayer?.access ?? Access.USER;
  const isAdmin = access >= Access.ADMIN;

  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [commands, setCommands] = useState<CommandInfo[]>([]);
  const history = useRef<string[]>([]);
  const historyIdx = useRef<number>(0);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '`' && isAdmin && !isTyping()) {
        e.preventDefault();
        setVisible((v) => !v);
      }
    };
    window.addEventListener('toggleConsole', toggle);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('toggleConsole', toggle);
      window.removeEventListener('keydown', onKey);
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!visible) return;
    fetchCommands()
      .then(setCommands)
      .catch(() => undefined);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  if (!isAdmin || !visible) return null;

  const submit = async () => {
    const line = input.trim();
    if (!line) return;
    setLines((l) => [...l, { kind: 'in', text: line }]);
    history.current.push(line);
    historyIdx.current = history.current.length;
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
    if (e.key === 'Enter') {
      void submit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIdx.current > 0) {
        historyIdx.current -= 1;
        setInput(history.current[historyIdx.current] ?? '');
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx.current < history.current.length - 1) {
        historyIdx.current += 1;
        setInput(history.current[historyIdx.current] ?? '');
      } else {
        historyIdx.current = history.current.length;
        setInput('');
      }
    } else if (e.key === 'Escape') {
      setVisible(false);
    }
  };

  return (
    <div style={container}>
      <div style={header}>
        <span style={title}>Console</span>
        <button
          type="button"
          style={closeBtn}
          onClick={() => setVisible(false)}
          title="Close (Esc)"
        >
          ✕
        </button>
      </div>

      <div ref={logRef} style={log}>
        {lines.length === 0 && (
          <p style={hint}>
            Run a registered command. Try <code style={code}>players</code>,{' '}
            <code style={code}>broadcast Hello</code> or{' '}
            <code style={code}>mode maintenance</code>.
          </p>
        )}
        {lines.map((l, i) => (
          <div key={i} style={l.kind === 'in' ? lineIn : lineOut}>
            {l.kind === 'in' ? `> ${l.text}` : l.text}
          </div>
        ))}
      </div>

      {commands.length > 0 && (
        <div style={commandsHint} title="Available commands">
          {commands.map((c) => c.name).join('  ')}
        </div>
      )}

      <div style={inputRow}>
        <span style={prompt}>›</span>
        <input
          ref={inputRef}
          style={inputBox}
          value={input}
          spellCheck={false}
          autoComplete="off"
          placeholder="type a command and press Enter"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
};

const container: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  width: 'min(560px, calc(100vw - 32px))',
  height: 340,
  display: 'flex',
  flexDirection: 'column',
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  boxShadow: '0 8px 30px rgba(0,0,0,0.35)',
  zIndex: 1000,
  overflow: 'hidden',
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
};

const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  borderBottom: `1px solid ${colors.border}`,
  background: colors.surfaceMuted,
};

const title: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: colors.textMuted,
};

const closeBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: colors.textMuted,
  cursor: 'pointer',
  fontSize: 14,
};

const log: React.CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: '10px 12px',
  fontSize: 13,
  lineHeight: 1.5,
  color: colors.text,
};

const hint: React.CSSProperties = { color: colors.textMuted, margin: 0 };
const code: React.CSSProperties = {
  background: colors.surfaceMuted,
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

const commandsHint: React.CSSProperties = {
  padding: '4px 12px',
  fontSize: 11,
  color: colors.textMuted,
  borderTop: `1px solid ${colors.border}`,
  whiteSpace: 'nowrap',
  overflowX: 'auto',
};

const inputRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderTop: `1px solid ${colors.border}`,
  background: colors.surfaceMuted,
};

const prompt: React.CSSProperties = { color: colors.primary, fontWeight: 700 };

const inputBox: React.CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: colors.text,
  fontSize: 13,
  fontFamily: 'inherit',
};
