import React, { useEffect, useState } from 'react';
import { Access } from '../../shared/types';
import { useGame } from '../GameContext';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { PlayerModeration } from './moderation/PlayerModeration';
import { CommandConsole } from './moderation/CommandConsole';
import { Modal } from './common/Modal';
import { colors } from '../theme';
import { useT } from '../i18n';

type Tab = 'players' | 'commands';

// The in-game GM panel (X, MOD+): per-player moderation and server and
// script commands, a tab each. The operator's own character is a row too.
export const GMPanel: React.FC = () => {
  const t = useT();
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const access = livePlayer?.access ?? sessionPlayer?.access ?? Access.USER;
  const myName = livePlayer?.name ?? sessionPlayer?.name;

  const [visible, setVisible] = useState(false);
  const [tab, setTab] = useState<Tab>('players');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    window.addEventListener('toggleGMPanel', toggle);
    return () => window.removeEventListener('toggleGMPanel', toggle);
  }, []);

  if (access < Access.MOD || !visible) return null;

  const tabs: { id: Tab; label: string }[] = [
    { id: 'players', label: t('gm.tabPlayers') },
    { id: 'commands', label: t('gm.commands') },
  ];

  return (
    <Modal title={t('gm.title')} onClose={() => setVisible(false)} width={460}>
      <nav style={tabBar} aria-label={t('gm.title')}>
        {tabs.map((entry) => (
          <button
            key={entry.id}
            className="content-tab"
            aria-pressed={tab === entry.id}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>
      {/* Hidden rather than unmounted: switching tabs keeps the console log,
          its command history and the picked target. */}
      <div hidden={tab !== 'players'}>
        <PlayerModeration
          access={access}
          self={myName}
          allowRelativeTeleport
          onResult={setStatus}
        />
        {status && <div style={statusLine}>{status}</div>}
      </div>
      <div hidden={tab !== 'commands'}>
        <CommandConsole height={280} />
      </div>
    </Modal>
  );
};

const tabBar: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  paddingBottom: 10,
  marginBottom: 12,
  borderBottom: `1px solid ${colors.border}`,
};
const statusLine: React.CSSProperties = {
  marginTop: 10,
  fontSize: 13,
  color: colors.textMuted,
};
