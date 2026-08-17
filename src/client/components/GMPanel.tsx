import React, { useEffect, useMemo, useState } from 'react';
import { Access } from '../../shared/types';
import { useGame } from '../context/GameContext';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { modMoveMap, modSetMyAccess, changeSprite } from '../io/network';
import { PlayerModeration } from './moderation/PlayerModeration';
import { CommandConsole } from './moderation/CommandConsole';
import { chatResultMsg } from './ChatPanel';
import { Modal } from './common/Modal';
import { colors, radius } from '../theme';
import { useT } from '../i18n';

// The single in-game GM panel: per-player moderation (by name or from the
// list), server and script commands, and self actions, in one place to
// moderate while watching the game. X or the GM action button opens it
// for MOD and above.
export const GMPanel: React.FC = () => {
  const t = useT();
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const access = livePlayer?.access ?? sessionPlayer?.access ?? Access.USER;

  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState('');
  const [mapId, setMapId] = useState('');
  const [myAccess, setMyAccess] = useState<Access>(Access.USER);
  const [mySprite, setMySprite] = useState(0);

  const accessOptions = useMemo(
    () =>
      (
        Object.values(Access).filter((v) => typeof v === 'number') as Access[]
      ).map((lvl) => ({ value: lvl, label: Access[lvl] })),
    [],
  );

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    window.addEventListener('toggleGMPanel', toggle);
    return () => window.removeEventListener('toggleGMPanel', toggle);
  }, []);

  if (access < Access.MOD || !visible) return null;

  const doSelf = async (fn: () => Promise<unknown>, ok: string) => {
    const res = await fn();
    chatResultMsg(!!res, ok, t('gm.failed'));
  };

  return (
    <Modal title={t('gm.title')} onClose={() => setVisible(false)} width={420}>
      <div style={layout}>
        <PlayerModeration
          access={access}
          allowRelativeTeleport
          onResult={setStatus}
        />
        {status && <div style={statusLine}>{status}</div>}

        <hr style={divider} />
        <h4 style={sectionTitle}>{t('gm.commands')}</h4>
        <CommandConsole height={160} />

        <hr style={divider} />
        <h4 style={sectionTitle}>{t('gm.myself')}</h4>
        <div style={row}>
          <input
            style={{ ...input, flex: 1 }}
            placeholder={t('gm.mapId')}
            value={mapId}
            onChange={(e) => setMapId(e.target.value)}
          />
          <button
            style={btn}
            onClick={() =>
              void doSelf(() => modMoveMap(mapId.trim()), t('gm.moved'))
            }
          >
            {t('gm.go')}
          </button>
        </div>
        {access >= Access.ADMIN && (
          <div style={row}>
            <select
              style={{ ...input, flex: 1 }}
              value={myAccess}
              onChange={(e) => setMyAccess(+e.target.value)}
            >
              {accessOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              style={btn}
              onClick={() =>
                void doSelf(() => modSetMyAccess(myAccess), t('gm.accessSet'))
              }
            >
              {t('gm.setAccess')}
            </button>
          </div>
        )}
        <div style={row}>
          <input
            style={{ ...input, flex: 1 }}
            type="number"
            placeholder={t('gm.mySprite')}
            value={mySprite}
            onChange={(e) => setMySprite(+e.target.value)}
          />
          <button
            style={btn}
            onClick={() =>
              void doSelf(() => changeSprite(mySprite), t('gm.spriteSet'))
            }
          >
            {t('gm.setSprite')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

const layout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const sectionTitle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: colors.textMuted,
};
const divider: React.CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${colors.border}`,
  margin: '2px 0',
  width: '100%',
};
const row: React.CSSProperties = { display: 'flex', gap: 6 };
const input: React.CSSProperties = {
  padding: '7px 9px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.sm,
  outline: 'none',
  fontSize: 14,
  background: colors.surface,
  boxSizing: 'border-box',
  minWidth: 0,
};
const btn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '7px 12px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  flexShrink: 0,
};
const statusLine: React.CSSProperties = {
  fontSize: 13,
  color: colors.textMuted,
};
