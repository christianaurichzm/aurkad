import React, { useEffect, useState } from 'react';
import {
  adminLogin,
  adminSession,
  adminLogout,
  type AdminSession,
} from '../io/network';
import { Access } from '../../shared/types';
import { PlayerModeration } from '../components/moderation/PlayerModeration';
import { CommandConsole } from '../components/moderation/CommandConsole';
import { ScriptEditor } from '../components/scripting/ScriptEditor';
import { colors, radius } from '../theme';

// Standalone operator dashboard served at /admin, apart from the game client:
// log in with a mod/admin account and moderate from any browser, no gameplay.
export const AdminApp: React.FC = () => {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    adminSession()
      .then(setSession)
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return <div style={centered}>Loading…</div>;
  }

  if (!session) {
    return <AdminLogin onLogin={setSession} />;
  }

  return (
    <div style={page}>
      <header style={header}>
        <div style={brand}>Admin panel</div>
        <div style={headerRight}>
          <span style={who}>
            {session.username} · {Access[session.access]}
          </span>
          <button
            style={logoutBtn}
            onClick={() =>
              void adminLogout().then(() => {
                setSession(null);
              })
            }
          >
            Log out
          </button>
        </div>
      </header>
      <main style={grid}>
        <section style={panel}>
          <h2 style={panelTitle}>Online players</h2>
          <PlayerModeration access={session.access} onResult={setStatus} />
          {status && <div style={statusLine}>{status}</div>}
        </section>
        <section style={panel}>
          <h2 style={panelTitle}>Console</h2>
          <CommandConsole height={260} />
        </section>
        {session.scriptEditorEnabled && (
          <section style={{ ...panel, ...wideSection }}>
            <h2 style={panelTitle}>Scripts</h2>
            <ScriptEditor height={520} />
          </section>
        )}
      </main>
    </div>
  );
};

const AdminLogin: React.FC<{ onLogin: (s: AdminSession) => void }> = ({
  onLogin,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username || !password) return;
    setBusy(true);
    setError('');
    try {
      onLogin(await adminLogin(username, password));
    } catch (e: unknown) {
      setError((e as { message?: string })?.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={centered}>
      <form
        style={loginCard}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1 style={loginTitle}>Admin panel</h1>
        <p style={loginSub}>Sign in with a moderator or admin account.</p>
        <input
          style={loginInput}
          placeholder="Username"
          value={username}
          autoFocus
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          style={loginInput}
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={loginError}>{error}</div>}
        <button style={loginBtn} type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
};

const page: React.CSSProperties = {
  minHeight: '100vh',
  background: colors.surfaceMuted,
  color: colors.text,
};
const header: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 20px',
  background: colors.surface,
  borderBottom: `1px solid ${colors.border}`,
};
const brand: React.CSSProperties = { fontWeight: 800, fontSize: 16 };
const headerRight: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};
const who: React.CSSProperties = { color: colors.textMuted, fontSize: 13 };
const logoutBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '6px 12px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontSize: 13,
};
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
  gap: 16,
  padding: 20,
  maxWidth: 1300,
  margin: '0 auto',
};
const wideSection: React.CSSProperties = {
  gridColumn: '1 / -1',
};
const panel: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const panelTitle: React.CSSProperties = { margin: 0, fontSize: 16 };
const statusLine: React.CSSProperties = {
  fontSize: 13,
  color: colors.textMuted,
};
const centered: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: colors.surfaceMuted,
  color: colors.text,
};
const loginCard: React.CSSProperties = {
  width: 320,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: 24,
};
const loginTitle: React.CSSProperties = { margin: 0, fontSize: 20 };
const loginSub: React.CSSProperties = {
  margin: 0,
  color: colors.textMuted,
  fontSize: 13,
};
const loginInput: React.CSSProperties = {
  padding: '9px 11px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.sm,
  outline: 'none',
  fontSize: 14,
  background: colors.surface,
};
const loginError: React.CSSProperties = { color: colors.danger, fontSize: 13 };
const loginBtn: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '10px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 14,
};
