import React, { useCallback, useEffect, useState } from 'react';
import { fetchOnlinePlayers } from '../io/network';
import { colors, radius } from '../theme';
import { Modal } from './common/Modal';
import { useT } from '../i18n';

// Read-only "who's online" list for every player. Moderation lives in the GM
// panel (X), so this stays a plain social list.
export const OnlinePlayersModal: React.FC = () => {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [players, setPlayers] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await fetchOnlinePlayers();
      setPlayers(response.players);
      setCount(response.count);
    } catch (e: unknown) {
      setError(
        (e as { message?: string })?.message || 'Failed to load online players',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleOnlinePlayers', onToggle);
    return () => window.removeEventListener('toggleOnlinePlayers', onToggle);
  }, []);

  useEffect(() => {
    if (!visible) return;
    void loadPlayers();
  }, [loadPlayers, visible]);

  if (!visible) return null;

  return (
    <Modal
      title={t('online.title')}
      onClose={() => setVisible(false)}
      width={380}
    >
      <div style={layout}>
        <div style={toolbar}>
          <div style={countBadge}>{t('online.count', { count })}</div>
          <button
            type="button"
            className="button-primary"
            style={refreshButton(loading)}
            onClick={() => void loadPlayers()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && <p style={errorStyle}>{error}</p>}

        {loading && players.length === 0 ? (
          <div style={emptyState}>{t('online.loading')}</div>
        ) : players.length > 0 ? (
          <ul style={list}>
            {players.map((name, index) => (
              <li key={name} style={listItem(index === players.length - 1)}>
                <span style={statusDot} />
                <span style={playerName}>{name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={emptyState}>{t('online.none')}</div>
        )}
      </div>
    </Modal>
  );
};

const layout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const toolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
};

const countBadge: React.CSSProperties = {
  color: colors.success,
  background: colors.selected,
  border: `1px solid ${colors.success}`,
  borderRadius: radius.control,
  padding: '8px 12px',
  fontSize: 14,
  fontWeight: 700,
};

const refreshButton = (loading: boolean): React.CSSProperties => ({
  padding: '9px 12px',
  fontSize: 13,
  cursor: loading ? 'wait' : 'pointer',
  opacity: loading ? 0.65 : 1,
});

const list: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 320,
  overflowY: 'auto',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.panel,
  background: colors.surfaceMuted,
};

const listItem = (last: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderBottom: last ? 'none' : `1px solid ${colors.border}`,
});

const statusDot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: colors.success,
  flex: '0 0 auto',
};

const playerName: React.CSSProperties = {
  minWidth: 0,
  color: colors.text,
  fontSize: 14,
  fontWeight: 600,
  wordBreak: 'break-word',
};

const emptyState: React.CSSProperties = {
  color: colors.textMuted,
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.panel,
  padding: '20px 12px',
  textAlign: 'center',
  fontSize: 14,
  fontWeight: 600,
};

const errorStyle: React.CSSProperties = {
  color: colors.dangerText,
  fontSize: 13,
  margin: 0,
};
