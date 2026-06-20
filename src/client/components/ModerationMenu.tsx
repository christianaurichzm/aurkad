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
import { colors, radius, shadow, zIndex } from '../theme';

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

  const accessLevels: Access[] = useMemo(() => {
    return Object.values(Access).filter(
      (v) => typeof v === 'number',
    ) as Access[];
  }, []);

  useEffect(() => {
    setAccess(accessLevels[0]);
    setMyAccess(accessLevels[0]);
  }, [accessLevels]);

  useEffect(() => {
    const toggle = () => setVisible((v) => !v);
    window.addEventListener('toggleModMenu', toggle);
    return () => window.removeEventListener('toggleModMenu', toggle);
  }, []);

  const requirePlayerName = (): string | null => {
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

  const accessOptions: SelectOption[] = accessLevels.map((lvl) => ({
    value: lvl.toString(),
    label: lvl.toString(),
  }));

  const doAction = async (
    fn: () => Promise<any>,
    success: string,
    fail: string,
  ) => {
    const res = await fn();
    chatResultMsg(!!res, success, fail);
  };

  if (!visible) return null;

  return (
    <div style={styles.container}>
      <button style={styles.closeBtn} onClick={() => setVisible(false)}>
        x
      </button>
      <h3 style={styles.title}>Moderation Menu</h3>

      <div style={styles.group}>
        <h4 style={styles.groupTitle}>Players</h4>
        <label style={styles.label}>Player Name</label>
        <input
          style={styles.input}
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Type player name…"
        />
        <div style={styles.actions}>
          <button
            style={styles.btn}
            onClick={() =>
              doAction(
                () => modKick(requirePlayerName()!),
                'Player kicked!',
                'Failed to kick.',
              )
            }
          >
            Kick
          </button>
          <button
            style={styles.btn}
            onClick={() =>
              doAction(
                () => modBring(requirePlayerName()!),
                'Player brought!',
                'Failed to bring.',
              )
            }
          >
            Bring
          </button>
          <button
            style={styles.btn}
            onClick={() =>
              doAction(
                () => modGoto(requirePlayerName()!),
                'Teleported!',
                'Failed to teleport.',
              )
            }
          >
            Go To
          </button>
        </div>

        <div style={styles.extraField}>
          <label style={styles.label}>Access</label>
          <Select
            options={accessOptions}
            value={access.toString()}
            onChange={(v) => setAccess(+v)}
          />
          <button
            style={{ ...styles.btn, ...styles.btnSmall }}
            onClick={() =>
              doAction(
                () => modSetAccess(requirePlayerName()!, access),
                'Access changed!',
                'Failed to change access.',
              )
            }
          >
            Set
          </button>
        </div>

        <div style={styles.extraField}>
          <label style={styles.label}>Sprite</label>
          <input
            style={styles.input}
            type="number"
            value={spriteId}
            onChange={(e) => setSpriteId(+e.target.value)}
          />
          <button
            style={{ ...styles.btn, ...styles.btnSmall }}
            onClick={() =>
              doAction(
                () => modSetSprite(requirePlayerName()!, spriteId),
                'Sprite changed!',
                'Failed to change sprite.',
              )
            }
          >
            Set
          </button>
        </div>

        <div style={{ ...styles.extraField, ...styles.banSection }}>
          <label style={styles.label}>Ban Player</label>
          <input
            style={styles.input}
            placeholder="Reason (opt.)"
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
          />
          <input
            style={styles.input}
            type="number"
            placeholder="Duration (min)"
            value={banDuration}
            onChange={(e) => setBanDuration(+e.target.value)}
          />
          <button
            style={{ ...styles.btn, ...styles.btnSmall, ...styles.btnDanger }}
            onClick={() =>
              doAction(
                () =>
                  modBan(
                    requirePlayerName()!,
                    banReason,
                    banDuration ? Date.now() + banDuration * 60000 : undefined,
                  ),
                'Player banned!',
                'Failed to ban.',
              )
            }
          >
            Ban
          </button>
        </div>
      </div>

      <hr style={styles.divider} />

      <div style={styles.group}>
        <h4 style={styles.groupTitle}>My self</h4>
        <div style={styles.extraField}>
          <label style={styles.label}>Move to Map</label>
          <input
            style={styles.input}
            value={mapId}
            onChange={(e) => setMapId(e.target.value)}
            placeholder="Map ID"
          />
          <button
            style={{ ...styles.btn, ...styles.btnSmall }}
            onClick={() =>
              doAction(
                () => modMoveMap(mapId.trim()),
                'You moved maps!',
                'Failed to move.',
              )
            }
          >
            Go
          </button>
        </div>
        <div style={styles.extraField}>
          <label style={styles.label}>My Access</label>
          <Select
            options={accessOptions}
            value={myAccess.toString()}
            onChange={(v) => setMyAccess(+v)}
          />
          <button
            style={{ ...styles.btn, ...styles.btnSmall }}
            onClick={() =>
              doAction(
                () => modSetMyAccess(myAccess),
                'Your access changed!',
                'Failed.',
              )
            }
          >
            Set
          </button>
        </div>
        <div style={styles.extraField}>
          <label style={styles.label}>My Sprite</label>
          <input
            style={styles.input}
            type="number"
            value={mySprite}
            onChange={(e) => setMySprite(+e.target.value)}
          />
          <button
            style={{ ...styles.btn, ...styles.btnSmall }}
            onClick={() =>
              doAction(
                () => changeSprite(mySprite),
                'Your sprite changed!',
                'Failed.',
              )
            }
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    position: 'absolute' as const,
    top: 15,
    right: 15,
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 15,
    background: colors.surface,
    padding: 20,
    borderRadius: radius.lg,
    boxShadow: shadow.raised,
    maxWidth: 320,
    zIndex: zIndex.hud,
  },
  closeBtn: {
    position: 'absolute' as const,
    top: 8,
    right: 8,
    border: 'none',
    background: 'transparent',
    fontSize: '1.2rem',
    cursor: 'pointer',
  },
  title: {
    margin: 0,
    color: colors.primary,
    fontWeight: 700,
    textAlign: 'center' as const,
    fontSize: '1.2rem',
  },
  group: {
    background: '#f9f9f9',
    borderRadius: radius.lg,
    padding: '18px 15px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 12,
    border: '1px solid #e9fbe9',
  },
  groupTitle: {
    margin: 0,
    marginBottom: 5,
    color: colors.text,
    fontWeight: 700,
    fontSize: '1rem',
    textAlign: 'left' as const,
  },
  label: {
    fontWeight: 600,
    color: '#218c49',
    fontSize: 14,
    marginBottom: 2,
    display: 'block' as const,
  },
  input: {
    width: '100%',
    padding: '9px 10px',
    border: '1.5px solid #a0e0a0',
    borderRadius: 6,
    outline: 'none',
    fontSize: 14,
    background: '#fff',
    marginBottom: 5,
    transition: 'border 0.16s, background 0.16s',
  },
  actions: {
    display: 'flex' as const,
    gap: 10,
    marginTop: 5,
    flexWrap: 'wrap' as const,
  },
  btn: {
    background: colors.primary,
    color: '#fff',
    border: 'none',
    padding: '9px 16px',
    borderRadius: radius.md,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    transition: 'background 0.2s',
    flexGrow: 1,
    textAlign: 'center' as const,
  },
  btnSmall: {
    padding: '7px 12px',
    fontSize: 12,
    flexGrow: 0,
  },
  btnDanger: {
    background: colors.danger,
  },
  divider: {
    border: 'none',
    borderTop: '1px solid #e0e0e0',
    margin: '10px 0',
  },
  extraField: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: 8,
    flexWrap: 'wrap' as const,
    marginBottom: 10,
  },
  banSection: {
    flexDirection: 'column' as const,
    alignItems: 'stretch' as const,
    backgroundColor: '#fff0f0',
    padding: 10,
    borderRadius: radius.sm,
    border: '1px solid #f0c0c0',
  },
};
