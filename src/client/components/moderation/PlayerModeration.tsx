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
} from '../../io/network';
import { Access } from '../../../shared/types';
import { colors, radius } from '../../theme';

// Moderation core shared by the in-game GM panel and the /admin dashboard.
// The name field is the one target: type a known name to act on it, offline
// players included (to ban, say), or click a row to fill it; the online
// list filters as you type. `allowRelativeTeleport` shows Bring and Go To,
// which only make sense in-game where the operator has a position.
export const PlayerModeration: React.FC<{
  access: number;
  allowRelativeTeleport?: boolean;
  onResult: (message: string) => void;
}> = ({ access, allowRelativeTeleport = false, onResult }) => {
  const canAdmin = access >= Access.ADMIN;

  const [players, setPlayers] = useState<string[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [target, setTarget] = useState('');

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
    } catch (e: unknown) {
      onResult((e as { message?: string })?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [onResult]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = players.filter((p) =>
    p.toLowerCase().includes(target.trim().toLowerCase()),
  );

  const name = target.trim();
  const hasTarget = name.length > 0;

  const run = async (
    fn: () => Promise<unknown>,
    ok: string,
    fail: string,
    refresh = false,
  ) => {
    if (!hasTarget) return;
    try {
      const res = await fn();
      onResult(res ? ok : fail);
    } catch (e: unknown) {
      onResult((e as { message?: string })?.message || fail);
    }
    if (refresh) void load();
  };

  return (
    <div style={wrap}>
      <div style={head}>
        <span style={countBadge}>{count} online</span>
        <button style={ghostBtn} onClick={() => void load()} disabled={loading}>
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      <input
        style={input}
        placeholder="Player name (type or pick below)"
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />

      <ul style={list}>
        {filtered.length === 0 ? (
          <li style={emptyRow}>
            {players.length === 0 ? 'No players online.' : 'No match.'}
          </li>
        ) : (
          filtered.map((p) => (
            <li
              key={p}
              style={row(p === name)}
              onClick={() => setTarget(p)}
              role="button"
            >
              <span style={dot} />
              {p}
            </li>
          ))
        )}
      </ul>

      <div style={actions(hasTarget)}>
        <div style={rowWrap}>
          <button
            style={dangerBtn}
            onClick={() =>
              run(() => modKick(name), 'Kicked.', 'Kick failed.', true)
            }
          >
            Kick
          </button>
          {allowRelativeTeleport && (
            <>
              <button
                style={btn}
                onClick={() => run(() => modBring(name), 'Brought.', 'Failed.')}
              >
                Bring
              </button>
              <button
                style={btn}
                onClick={() =>
                  run(() => modGoto(name), 'Teleported.', 'Failed.')
                }
              >
                Go To
              </button>
            </>
          )}
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
                () => modWarp(name, warpMap.trim(), warpCol, warpRow),
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
              run(() => modSetSprite(name, spriteId), 'Sprite set.', 'Failed.')
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
                    () => modSetAccess(name, accessLevel),
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
                          name,
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
    </div>
  );
};

const wrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const head: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const countBadge: React.CSSProperties = {
  color: colors.success,
  fontWeight: 700,
  fontSize: 13,
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
const list: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 180,
  overflowY: 'auto',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
};
const row = (sel: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  cursor: 'pointer',
  borderBottom: `1px solid ${colors.border}`,
  background: sel ? colors.surfaceMuted : 'transparent',
  fontSize: 14,
});
const emptyRow: React.CSSProperties = {
  padding: '12px',
  textAlign: 'center',
  color: colors.textMuted,
  fontSize: 13,
};
const dot: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: colors.success,
};
const actions = (enabled: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  opacity: enabled ? 1 : 0.5,
  pointerEvents: enabled ? 'auto' : 'none',
});
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
const dangerBtn: React.CSSProperties = { ...btn, background: colors.danger };
const banBox: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  background: '#fff5f5',
  border: `1px solid #f5c6c6`,
  borderRadius: radius.sm,
  padding: 10,
};
