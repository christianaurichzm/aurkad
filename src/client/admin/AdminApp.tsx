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
import { AuditLog } from '../components/moderation/AuditLog';
import { colors, radius } from '../theme';
import { useT } from '../i18n';

// Lazy, since Monaco is about 90% of the client bundle and the game shares
// it with this panel: a static import makes every player download the editor,
// which SCRIPT_EDITOR_ENABLED leaves off by default.
const ScriptEditor = React.lazy(() =>
  import('../components/scripting/ScriptEditor').then((m) => ({
    default: m.ScriptEditor,
  })),
);

// Standalone operator dashboard served at /admin, apart from the game client:
// log in with a mod/admin account and moderate from any browser, no gameplay.
export const AdminApp: React.FC = () => {
  const t = useT();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    adminSession()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return <div style={centered}>{t('common.loading')}</div>;
  }

  if (!session) {
    return <AdminLogin onLogin={setSession} />;
  }

  return (
    <div style={page}>
      <header style={header}>
        <div style={brand}>{t('admin.title')}</div>
        <div style={headerRight}>
          <span style={who}>
            {session.username} · {Access[session.access]}
          </span>
          {/* A new tab, not a navigation: an operator who moderates while
              playing keeps both, and the panel session survives either way. */}
          <a style={gameLink} href="/" target="_blank" rel="noreferrer">
            {t('admin.openGame')}
          </a>
          <button
            style={logoutBtn}
            onClick={() =>
              void adminLogout().then(() => {
                setSession(null);
              })
            }
          >
            {t('admin.logout')}
          </button>
        </div>
      </header>
      <main style={grid}>
        <section style={panel}>
          <h2 style={panelTitle}>{t('online.title')}</h2>
          <PlayerModeration access={session.access} onResult={setStatus} />
          {status && <div style={statusLine}>{status}</div>}
        </section>
        <section style={panel}>
          <h2 style={panelTitle}>{t('admin.console')}</h2>
          <CommandConsole height={260} />
        </section>
        {session.scriptEditorEnabled && (
          <section style={{ ...panel, ...wideSection }}>
            <h2 style={panelTitle}>{t('admin.scripts')}</h2>
            <React.Suspense
              fallback={<div style={statusLine}>{t('common.loading')}</div>}
            >
              <ScriptEditor height={520} />
            </React.Suspense>
          </section>
        )}
        {session.access >= Access.ADMIN && (
          <section style={{ ...panel, ...wideSection }}>
            <h2 style={panelTitle}>{t('admin.audit')}</h2>
            <AuditLog height={260} />
          </section>
        )}
      </main>
    </div>
  );
};

const AdminLogin: React.FC<{ onLogin: (s: AdminSession) => void }> = ({
  onLogin,
}) => {
  const t = useT();
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
      setError((e as { message?: string })?.message || t('admin.loginFailed'));
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
        <h1 style={loginTitle}>{t('admin.title')}</h1>
        <p style={loginSub}>{t('admin.loginHint')}</p>
        <input
          style={loginInput}
          placeholder={t('auth.username')}
          value={username}
          autoFocus
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          style={loginInput}
          type="password"
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div style={loginError}>{error}</div>}
        <button style={loginBtn} type="submit" disabled={busy}>
          {busy ? t('admin.signingIn') : t('admin.signIn')}
        </button>
      </form>
    </div>
  );
};

// Scrolls inside itself rather than the document: styles.css pins the
// body to 100vh with overflow hidden for the game canvas, which this page
// inherits, so anything below the fold could not be reached otherwise.
const page: React.CSSProperties = {
  height: '100vh',
  overflowY: 'auto',
  background: colors.surfaceMuted,
  color: colors.text,
};
// Sticky so "Log out" and the session line stay reachable once the page is
// long enough to scroll.
const header: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
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
const gameLink: React.CSSProperties = {
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '6px 12px',
  borderRadius: radius.sm,
  fontSize: 13,
  textDecoration: 'none',
};
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
