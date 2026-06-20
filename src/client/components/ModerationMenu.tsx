import React, { useEffect, useMemo, useState } from 'react';
import { Access } from '../../shared/types';
import {
  modKick,
  modBring,
  modGoto,
  modSetAccess,
  modSetSprite,
  modBan,
  modMoveMap,
  modSetMyAccess,
  changeSprite,
} from '../io/network';
import { displayChatMessage, chatResultMsg } from './ChatPanel';
import { SelectOption, Select } from './common/Select/Select';
import { Modal } from './common/Modal';
import { colors, radius } from '../theme';

export const ModerationMenu: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [access, setAccess] = useState<Access>(Access.USER);
  const [spriteId, setSpriteId] = useState(0);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState(0);
  const [mapId, setMapId] = useState('');
  const [myAccess, setMyAccess] = useState<Access>(Access.USER);
  const [mySprite, setMySprite] = useState(0);

  const accessLevels: Access[] = useMemo(
    () =>
      Object.values(Access).filter((v) => typeof v === 'number') as Access[],
    [],
  );

  useEffect(() => {
    setAccess(accessLevels[0]);
    setMyAccess(accessLevels[0]);
  }, [accessLevels]);

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    window.addEventListener('toggleModMenu', toggle);
    return () => window.removeEventListener('toggleModMenu', toggle);
  }, []);

  const requireName = (): string | null => {
    const p = playerName.trim();
    if (!p) {
      displayChatMessage({
        message: 'Enter the player name.',
        scope: 'player',
        type: 'chat',
      });
      return null;
    }
    return p;
  };

  const doAction = async (
    fn: () => Promise<any>,
    success: string,
    fail: string,
  ) => {
    const res = await fn();
    chatResultMsg(!!res, success, fail);
  };

  const accessOptions: SelectOption[] = accessLevels.map((lvl) => ({
    value: lvl.toString(),
    label: lvl.toString(),
  }));

  if (!visible) return null;

  return (
    <Modal title="Moderation" onClose={() => setVisible(false)} width={340}>
      <div style={layout}>
        <section style={section}>
          <h4 style={sectionTitle}>Player actions</h4>

          <div style={field}>
            <label style={label}>Player name</label>
            <input
              style={input}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Type player name…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const p = requireName();
                  if (p)
                    doAction(
                      () => modKick(p),
                      'Player kicked!',
                      'Failed to kick.',
                    );
                }
              }}
            />
          </div>

          <div style={btnRow}>
            <button
              style={actionBtn}
              onClick={() => {
                const p = requireName();
                if (p)
                  doAction(
                    () => modKick(p),
                    'Player kicked!',
                    'Failed to kick.',
                  );
              }}
            >
              Kick
            </button>
            <button
              style={actionBtn}
              onClick={() => {
                const p = requireName();
                if (p)
                  doAction(
                    () => modBring(p),
                    'Player brought!',
                    'Failed to bring.',
                  );
              }}
            >
              Bring
            </button>
            <button
              style={actionBtn}
              onClick={() => {
                const p = requireName();
                if (p)
                  doAction(
                    () => modGoto(p),
                    'Teleported!',
                    'Failed to teleport.',
                  );
              }}
            >
              Go To
            </button>
          </div>

          <div style={inlineRow}>
            <div style={{ flex: 1 }}>
              <label style={label}>Access</label>
              <Select
                options={accessOptions}
                value={access.toString()}
                onChange={(v) => setAccess(+v)}
              />
            </div>
            <button
              style={{ ...setBtn, marginTop: 18 }}
              onClick={() => {
                const p = requireName();
                if (p)
                  doAction(
                    () => modSetAccess(p, access),
                    'Access changed!',
                    'Failed.',
                  );
              }}
            >
              Set
            </button>
          </div>

          <div style={inlineRow}>
            <div style={{ flex: 1 }}>
              <label style={label}>Sprite ID</label>
              <input
                style={input}
                type="number"
                value={spriteId}
                onChange={(e) => setSpriteId(+e.target.value)}
              />
            </div>
            <button
              style={{ ...setBtn, marginTop: 18 }}
              onClick={() => {
                const p = requireName();
                if (p)
                  doAction(
                    () => modSetSprite(p, spriteId),
                    'Sprite changed!',
                    'Failed.',
                  );
              }}
            >
              Set
            </button>
          </div>

          <div style={banBox}>
            <label style={label}>Ban player</label>
            <input
              style={input}
              placeholder="Reason (optional)"
              value={banReason}
              onChange={(e) => setBanReason(e.target.value)}
            />
            <div style={inlineRow}>
              <input
                style={{ ...input, flex: 1 }}
                type="number"
                placeholder="Duration (min, 0 = permanent)"
                value={banDuration}
                onChange={(e) => setBanDuration(+e.target.value)}
              />
              <button
                style={banBtn}
                onClick={() => {
                  const p = requireName();
                  if (p)
                    doAction(
                      () =>
                        modBan(
                          p,
                          banReason,
                          banDuration
                            ? Date.now() + banDuration * 60000
                            : undefined,
                        ),
                      'Player banned!',
                      'Failed to ban.',
                    );
                }}
              >
                Ban
              </button>
            </div>
          </div>
        </section>

        <hr style={divider} />

        <section style={section}>
          <h4 style={sectionTitle}>My self</h4>

          <div style={inlineRow}>
            <div style={{ flex: 1 }}>
              <label style={label}>Move to map</label>
              <input
                style={input}
                value={mapId}
                onChange={(e) => setMapId(e.target.value)}
                placeholder="Map ID"
              />
            </div>
            <button
              style={{ ...setBtn, marginTop: 18 }}
              onClick={() =>
                doAction(() => modMoveMap(mapId.trim()), 'Moved!', 'Failed.')
              }
            >
              Go
            </button>
          </div>

          <div style={inlineRow}>
            <div style={{ flex: 1 }}>
              <label style={label}>My access</label>
              <Select
                options={accessOptions}
                value={myAccess.toString()}
                onChange={(v) => setMyAccess(+v)}
              />
            </div>
            <button
              style={{ ...setBtn, marginTop: 18 }}
              onClick={() =>
                doAction(
                  () => modSetMyAccess(myAccess),
                  'Access changed!',
                  'Failed.',
                )
              }
            >
              Set
            </button>
          </div>

          <div style={inlineRow}>
            <div style={{ flex: 1 }}>
              <label style={label}>My sprite</label>
              <input
                style={input}
                type="number"
                value={mySprite}
                onChange={(e) => setMySprite(+e.target.value)}
              />
            </div>
            <button
              style={{ ...setBtn, marginTop: 18 }}
              onClick={() =>
                doAction(
                  () => changeSprite(mySprite),
                  'Sprite changed!',
                  'Failed.',
                )
              }
            >
              Set
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
};

const layout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const section: React.CSSProperties = {
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

const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
  display: 'block',
  marginBottom: 2,
};

const input: React.CSSProperties = {
  width: '100%',
  padding: '7px 9px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.sm,
  outline: 'none',
  fontSize: 14,
  background: colors.surface,
  boxSizing: 'border-box',
};

const btnRow: React.CSSProperties = { display: 'flex', gap: 6 };

const actionBtn: React.CSSProperties = {
  flex: 1,
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '8px 0',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
};

const inlineRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
};

const setBtn: React.CSSProperties = {
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

const banBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: '#fff5f5',
  border: `1px solid #f5c6c6`,
  borderRadius: radius.md,
  padding: '10px 12px',
};

const banBtn: React.CSSProperties = {
  background: colors.danger,
  color: '#fff',
  border: 'none',
  padding: '7px 14px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  flexShrink: 0,
};

const divider: React.CSSProperties = {
  border: 'none',
  borderTop: `1px solid ${colors.border}`,
  margin: '4px 0',
};
