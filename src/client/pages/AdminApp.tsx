import { AuthLayout, useGameBrand } from '../components/common/AuthLayout';
import React, { useEffect, useState } from 'react';
import {
  adminLogin,
  adminSession,
  adminLogout,
  httpError,
  type AdminSession,
} from '../io/network';
import { Access } from '../../shared/types';
import { PlayerModeration } from '../components/moderation/PlayerModeration';
import { CommandConsole } from '../components/moderation/CommandConsole';
import { AuditLog } from '../components/moderation/AuditLog';
import { TwoFactorPanel } from '../components/moderation/TwoFactorPanel';
import { AppearancePanel } from '../components/moderation/AppearancePanel';
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
  const game = useGameBrand();
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
      <header className="admin-header" style={header}>
        <div style={brand}>
          {game && (
            <>
              <img src={game.logo} alt="" style={brandLogo} />
              <span>{game.name}</span>
            </>
          )}
          <span style={brandPanel}>{t('admin.title')}</span>
        </div>
        <div className="admin-header-actions" style={headerRight}>
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
        <section style={{ ...panel, alignSelf: 'start' }}>
          <h2 style={panelTitle}>{t('twofa.title')}</h2>
          <TwoFactorPanel />
        </section>
        {session.access >= Access.ADMIN && (
          <section style={{ ...panel, ...wideSection }}>
            <h2 style={panelTitle}>{t('admin.appearance')}</h2>
            <AppearancePanel />
          </section>
        )}
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
  const [totpToken, setTotpToken] = useState('');
  // Only after the server asks: whether an account is enrolled is not
  // something a login screen may be told before the password is right.
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!username || !password) return;
    setBusy(true);
    setError('');
    try {
      onLogin(await adminLogin(username, password, totpToken.trim()));
    } catch (e: unknown) {
      if (httpError(e).twoFactorRequired) setNeedsCode(true);
      setError((e as { message?: string })?.message || t('admin.loginFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title={t('admin.title')}>
      <form
        style={loginCard}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p style={loginSub}>{t('admin.loginHint')}</p>
        <input
          style={loginInput}
          aria-label={t('auth.username')}
          placeholder={t('auth.username')}
          value={username}
          autoFocus
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          style={loginInput}
          type="password"
          aria-label={t('auth.password')}
          placeholder={t('auth.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {needsCode && (
          <>
            <input
              style={loginInput}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              aria-label={t('auth.totpCode')}
              placeholder={t('auth.totpCode')}
              value={totpToken}
              onChange={(e) => setTotpToken(e.target.value)}
            />
            <p style={loginSub}>{t('auth.totpHint')}</p>
          </>
        )}
        {error && <div style={loginError}>{error}</div>}
        <button style={loginBtn} type="submit" disabled={busy}>
          {busy ? t('admin.signingIn') : t('admin.signIn')}
        </button>
      </form>
    </AuthLayout>
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
const brand: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontWeight: 800,
  fontSize: 16,
};
// No taller than the text beside it, so the sticky header stays one line.
const brandLogo: React.CSSProperties = { height: 22, width: 'auto' };
const brandPanel: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: colors.textMuted,
};
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
  borderRadius: radius.control,
  fontSize: 13,
  textDecoration: 'none',
};
const logoutBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '6px 12px',
  borderRadius: radius.control,
  cursor: 'pointer',
  fontSize: 13,
};
const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))',
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
  borderRadius: radius.control,
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
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};
const loginSub: React.CSSProperties = {
  margin: 0,
  color: colors.textMuted,
  fontSize: 13,
};
const loginInput: React.CSSProperties = {
  padding: '9px 11px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.control,
  outline: 'none',
  fontSize: 14,
  background: colors.surface,
};
const loginError: React.CSSProperties = {
  color: colors.dangerText,
  fontSize: 13,
};
const loginBtn: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '10px',
  borderRadius: radius.control,
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: 14,
};
