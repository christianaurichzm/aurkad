import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchOnlinePlayers,
  modKick,
  modBan,
  modWarp,
  modSetAccess,
  modSetSprite,
} from '../io/network';
import { Access } from '../../shared/types';
import { colors, radius } from '../theme';

// Standalone (no game) moderation of the online list for the /admin dashboard.
// Bring/Go To are intentionally omitted: those teleport relative to the
// operator's in-game position, and the operator has none here.
export const AdminPlayers: React.FC<{ access: number }> = ({ access }) => {
  const canAdmin = access >= Access.ADMIN;

  const [players, setPlayers] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const [warpMap, setWarpMap] = useState('');
  const [warpCol, setWarpCol] = useState(0);
  const [warpRow, setWarpRow] = useState(0);
  const [spriteId, setSpriteId] = useState(0);
  const [banReason, setBanReason] = useState('');
  const [banDuration, setBanDuration] = useState(0);
  const [accessLevel, setAccessLevel] = useState<Access>(Access.USER);

  const accessOptions = useMemo(
    () =>
      (
        Object.values(Access).filter((v) => typeof v === 'number') as Access[]
      ).map((lvl) => ({ value: lvl, label: Access[lvl] })),
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOnlinePlayers();
      setPlayers(res.players);
      setCount(res.count);
      setSelected((s) => (s && res.players.includes(s) ? s : null));
    } catch (e: unknown) {
      setStatus((e as { message?: string })?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (
    fn: () => Promise<unknown>,
    ok: string,
    fail: string,
    refresh = false,
  ) => {
    try {
      const res = await fn();
      setStatus(res ? ok : fail);
    } catch (e: unknown) {
      setStatus((e as { message?: string })?.message || fail);
    }
    if (refresh) void load();
  };

  return (
    <section style={panel}>
      <div style={panelHead}>
        <h2 style={panelTitle}>Online players</h2>
        <div style={rightHead}>
          <span style={countBadge}>{count} online</span>
          <button
            style={ghostBtn}
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {players.length === 0 ? (
        <div style={empty}>No players online.</div>
      ) : (
        <ul style={list}>
          {players.map((name) => (
            <li
              key={name}
              style={row(selected === name)}
              onClick={() => setSelected(selected === name ? null : name)}
            >
              <span style={dot} />
              <span style={{ flex: 1 }}>{name}</span>
              <span style={rowHint}>
                {selected === name ? 'selected' : 'manage'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <div style={actions}>
          <div style={actionsTitle}>Actions - {selected}</div>

          <div style={rowWrap}>
            <button
              style={dangerBtn}
              onClick={() =>
                run(() => modKick(selected), 'Kicked.', 'Kick failed.', true)
              }
            >
              Kick
            </button>
          </div>

          <div style={rowWrap}>
            <input
              style={{ ...input, flex: 2 }}
              placeholder="Map ID"
              value={warpMap}
              onChange={(e) => setWarpMap(e.target.value)}
            />
            <input
              style={{ ...input, width: 56 }}
              type="number"
              title="col"
              value={warpCol}
              onChange={(e) => setWarpCol(+e.target.value)}
            />
            <input
              style={{ ...input, width: 56 }}
              type="number"
              title="row"
              value={warpRow}
              onChange={(e) => setWarpRow(+e.target.value)}
            />
            <button
              style={btn}
              onClick={() =>
                run(
                  () => modWarp(selected, warpMap.trim(), warpCol, warpRow),
                  'Warped.',
                  'Warp failed.',
                )
              }
            >
              Warp
            </button>
          </div>

          <div style={rowWrap}>
            <input
              style={{ ...input, flex: 1 }}
              type="number"
              placeholder="Sprite ID"
              value={spriteId}
              onChange={(e) => setSpriteId(+e.target.value)}
            />
            <button
              style={btn}
              onClick={() =>
                run(
                  () => modSetSprite(selected, spriteId),
                  'Sprite set.',
                  'Failed.',
                )
              }
            >
              Set sprite
            </button>
          </div>

          {canAdmin && (
            <>
              <div style={rowWrap}>
                <select
                  style={{ ...input, flex: 1 }}
                  value={accessLevel}
                  onChange={(e) => setAccessLevel(+e.target.value)}
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
                    run(
                      () => modSetAccess(selected, accessLevel),
                      'Access set.',
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
                <div style={rowWrap}>
                  <input
                    style={{ ...input, flex: 1 }}
                    type="number"
                    placeholder="Minutes (0 = permanent)"
                    value={banDuration}
                    onChange={(e) => setBanDuration(+e.target.value)}
                  />
                  <button
                    style={dangerBtn}
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
                        'Banned.',
                        'Ban failed.',
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

      {status && <div style={statusLine}>{status}</div>}
    </section>
  );
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
const panelHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const panelTitle: React.CSSProperties = { margin: 0, fontSize: 16 };
const rightHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};
const countBadge: React.CSSProperties = {
  color: colors.success,
  fontWeight: 700,
  fontSize: 13,
};
const list: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 300,
  overflowY: 'auto',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
};
const row = (sel: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '9px 12px',
  cursor: 'pointer',
  borderBottom: `1px solid ${colors.border}`,
  background: sel ? colors.surfaceMuted : 'transparent',
  fontSize: 14,
});
const rowHint: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  color: colors.textMuted,
};
const dot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: colors.success,
};
const empty: React.CSSProperties = {
  padding: 16,
  textAlign: 'center',
  color: colors.textMuted,
};
const actions: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  padding: 12,
  background: colors.surfaceMuted,
};
const actionsTitle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  color: colors.textMuted,
};
const rowWrap: React.CSSProperties = { display: 'flex', gap: 6 };
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
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '7px 14px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  flexShrink: 0,
};
const ghostBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '5px 10px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontSize: 13,
};
const dangerBtn: React.CSSProperties = {
  ...btn,
  background: colors.danger,
  flex: 1,
};
const banBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: '#fff5f5',
  border: `1px solid #f5c6c6`,
  borderRadius: radius.sm,
  padding: 10,
};
const statusLine: React.CSSProperties = {
  fontSize: 13,
  color: colors.textMuted,
};
