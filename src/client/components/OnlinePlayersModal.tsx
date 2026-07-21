import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchOnlinePlayers,
  modKick,
  modBan,
  modBring,
  modGoto,
  modWarp,
  modSetAccess,
  modSetSprite,
} from '../io/network';
import { Access } from '../../shared/types';
import { useGame } from '../context/GameContext';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { chatResultMsg } from './ChatPanel';
import { SelectOption, Select } from './common/Select/Select';
import { colors, radius } from '../theme';
import { Modal } from './common/Modal';

export const OnlinePlayersModal: React.FC = () => {
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const access = livePlayer?.access ?? sessionPlayer?.access ?? Access.USER;
  const canModerate = access >= Access.MOD;
  const canAdmin = access >= Access.ADMIN;

  const [visible, setVisible] = useState(false);
  const [players, setPlayers] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  // Per-action inputs for the selected player.
  const [warpMap, setWarpMap] = useState('');
  const [warpCol, setWarpCol] = useState(0);
  const [warpRow, setWarpRow] = useState(0);
  const [spriteId, setSpriteId] = useState(0);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState(0);
  const [accessLevel, setAccessLevel] = useState<Access>(Access.USER);

  const accessOptions: SelectOption[] = useMemo(
    () =>
      (
        Object.values(Access).filter((v) => typeof v === 'number') as Access[]
      ).map((lvl) => ({ value: lvl.toString(), label: Access[lvl] })),
    [],
  );

  const loadPlayers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetchOnlinePlayers();
      setPlayers(response.players);
      setCount(response.count);
      setSelected((s) => (s && response.players.includes(s) ? s : null));
    } catch (e: unknown) {
      setError(
        (e as { message?: string })?.message || 'Failed to load players',
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
    if (visible) void loadPlayers();
    else setSelected(null);
  }, [loadPlayers, visible]);

  if (!visible) return null;

  const run = async (
    fn: () => Promise<unknown>,
    success: string,
    fail: string,
    refresh = false,
  ) => {
    const res = await fn();
    chatResultMsg(!!res, success, fail);
    if (refresh) void loadPlayers();
  };

  return (
    <Modal title="Online players" onClose={() => setVisible(false)} width={380}>
      <div style={layout}>
        <div style={toolbar}>
          <div style={countBadge}>{count} online</div>
          <button
            type="button"
            style={refreshButton(loading)}
            onClick={() => void loadPlayers()}
            disabled={loading}
          >
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        {error && <p style={errorStyle}>{error}</p>}

        {loading && players.length === 0 ? (
          <div style={emptyState}>Loading players...</div>
        ) : players.length > 0 ? (
          <ul style={list}>
            {players.map((name, index) => {
              const isSelected = selected === name;
              return (
                <li
                  key={name}
                  style={listItem(index === players.length - 1, isSelected)}
                  onClick={
                    canModerate
                      ? () => setSelected(isSelected ? null : name)
                      : undefined
                  }
                  role={canModerate ? 'button' : undefined}
                >
                  <span style={statusDot} />
                  <span style={playerName}>{name}</span>
                  {canModerate && (
                    <span style={manageHint}>
                      {isSelected ? 'selected' : 'manage'}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div style={emptyState}>No players online</div>
        )}

        {canModerate && selected && (
          <div style={actionsBox}>
            <div style={actionsTitle}>Actions - {selected}</div>

            <div style={btnRow}>
              <button
                style={actionBtn}
                onClick={() =>
                  run(
                    () => modKick(selected),
                    'Player kicked!',
                    'Failed to kick.',
                    true,
                  )
                }
              >
                Kick
              </button>
              <button
                style={actionBtn}
                onClick={() =>
                  run(() => modBring(selected), 'Brought!', 'Failed.')
                }
              >
                Bring
              </button>
              <button
                style={actionBtn}
                onClick={() =>
                  run(() => modGoto(selected), 'Teleported!', 'Failed.')
                }
              >
                Go To
              </button>
            </div>

            <div style={inlineRow}>
              <input
                style={{ ...input, flex: 2 }}
                placeholder="Map ID"
                value={warpMap}
                onChange={(e) => setWarpMap(e.target.value)}
              />
              <input
                style={{ ...input, width: 52 }}
                type="number"
                title="col"
                value={warpCol}
                onChange={(e) => setWarpCol(+e.target.value)}
              />
              <input
                style={{ ...input, width: 52 }}
                type="number"
                title="row"
                value={warpRow}
                onChange={(e) => setWarpRow(+e.target.value)}
              />
              <button
                style={setBtn}
                onClick={() =>
                  run(
                    () => modWarp(selected, warpMap.trim(), warpCol, warpRow),
                    'Warped!',
                    'Failed to warp.',
                  )
                }
              >
                Warp
              </button>
            </div>

            <div style={inlineRow}>
              <input
                style={{ ...input, flex: 1 }}
                type="number"
                placeholder="Sprite ID"
                value={spriteId}
                onChange={(e) => setSpriteId(+e.target.value)}
              />
              <button
                style={setBtn}
                onClick={() =>
                  run(
                    () => modSetSprite(selected, spriteId),
                    'Sprite set!',
                    'Failed.',
                  )
                }
              >
                Set sprite
              </button>
            </div>

            {canAdmin && (
              <>
                <div style={inlineRow}>
                  <div style={{ flex: 1 }}>
                    <Select
                      options={accessOptions}
                      value={accessLevel.toString()}
                      onChange={(v) => setAccessLevel(+v)}
                    />
                  </div>
                  <button
                    style={setBtn}
                    onClick={() =>
                      run(
                        () => modSetAccess(selected, accessLevel),
                        'Access set!',
                        'Failed.',
                      )
                    }
                  >
                    Set access
                  </button>
                </div>

                <div style={banBox}>
                  <input
                    style={input}
                    placeholder="Ban reason (optional)"
                    value={banReason}
                    onChange={(e) => setBanReason(e.target.value)}
                  />
                  <div style={inlineRow}>
                    <input
                      style={{ ...input, flex: 1 }}
                      type="number"
                      placeholder="Minutes (0 = permanent)"
                      value={banDuration}
                      onChange={(e) => setBanDuration(+e.target.value)}
                    />
                    <button
                      style={banBtn}
                      onClick={() =>
                        run(
                          () =>
                            modBan(
                              selected,
                              banReason,
                              banDuration
                                ? Date.now() + banDuration * 60000
                                : undefined,
                            ),
                          'Player banned!',
                          'Failed to ban.',
                          true,
                        )
                      }
                    >
                      Ban
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
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
  background: '#e8fdf0',
  border: `1px solid ${colors.success}`,
  borderRadius: radius.md,
  padding: '8px 12px',
  fontSize: 14,
  fontWeight: 700,
};

const refreshButton = (loading: boolean): React.CSSProperties => ({
  color: '#fff',
  background: colors.primary,
  border: 'none',
  borderRadius: radius.md,
  padding: '9px 12px',
  fontSize: 13,
  fontWeight: 700,
  cursor: loading ? 'wait' : 'pointer',
  opacity: loading ? 0.65 : 1,
});

const list: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 240,
  overflowY: 'auto',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  background: colors.surfaceMuted,
};

const listItem = (last: boolean, selected: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  borderBottom: last ? 'none' : `1px solid ${colors.border}`,
  background: selected ? colors.surface : 'transparent',
  cursor: 'pointer',
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
  flex: 1,
  color: colors.text,
  fontSize: 14,
  fontWeight: 600,
  wordBreak: 'break-word',
};

const manageHint: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: colors.textMuted,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const actionsBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
  background: colors.surfaceMuted,
};

const actionsTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: colors.textMuted,
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
  alignItems: 'center',
  gap: 6,
};

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

const setBtn: React.CSSProperties = {
  background: colors.surface,
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

const emptyState: React.CSSProperties = {
  color: colors.textMuted,
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.lg,
  padding: '20px 12px',
  textAlign: 'center',
  fontSize: 14,
  fontWeight: 600,
};

const errorStyle: React.CSSProperties = {
  color: colors.danger,
  fontSize: 13,
  margin: 0,
};
