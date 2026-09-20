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
import { useT } from '../../i18n';

// Moderation core shared by the in-game GM panel and the /admin dashboard.
// The name field is the one target: type a known name to act on it, offline
// players included (to ban, say), or click a row to fill it; the online
// list filters as you type. `allowRelativeTeleport` shows Bring and Go To,
// which only make sense in-game where the operator has a position.
export const PlayerModeration: React.FC<{
  access: Access;
  allowRelativeTeleport?: boolean;
  onResult: (message: string) => void;
}> = ({ access, allowRelativeTeleport = false, onResult }) => {
  const t = useT();
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
      onResult((e as { message?: string })?.message || t('mod.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [onResult, t]);

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
        <span style={countBadge}>{t('online.count', { count })}</span>
        <button style={ghostBtn} onClick={() => void load()} disabled={loading}>
          {loading ? '…' : t('mod.refresh')}
        </button>
      </div>

      <input
        style={input}
        placeholder={t('mod.targetPlaceholder')}
        value={target}
        onChange={(e) => setTarget(e.target.value)}
      />

      <ul style={list}>
        {filtered.length === 0 ? (
          <li style={emptyRow}>
            {players.length === 0 ? t('mod.nobodyOnline') : t('mod.noMatch')}
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
              run(
                () => modKick(name),
                t('mod.kicked'),
                t('mod.kickFailed'),
                true,
              )
            }
          >
            {t('mod.kick')}
          </button>
          {allowRelativeTeleport && (
            <>
              <button
                style={btn}
                onClick={() =>
                  run(() => modBring(name), t('mod.brought'), t('gm.failed'))
                }
              >
                {t('mod.bring')}
              </button>
              <button
                style={btn}
                onClick={() =>
                  run(() => modGoto(name), t('mod.teleported'), t('gm.failed'))
                }
              >
                {t('mod.goTo')}
              </button>
            </>
          )}
        </div>

        <div style={rowWrap}>
          <input
            style={{ ...input, flex: 2 }}
            placeholder={t('gm.mapId')}
            value={warpMap}
            onChange={(e) => setWarpMap(e.target.value)}
          />
          <input
            style={{ ...input, width: 56 }}
            type="number"
            title={t('questEditor.col')}
            value={warpCol}
            onChange={(e) => setWarpCol(+e.target.value)}
          />
          <input
            style={{ ...input, width: 56 }}
            type="number"
            title={t('questEditor.row')}
            value={warpRow}
            onChange={(e) => setWarpRow(+e.target.value)}
          />
          <button
            style={btn}
            onClick={() =>
              run(
                () => modWarp(name, warpMap.trim(), warpCol, warpRow),
                t('mod.warped'),
                t('mod.warpFailed'),
              )
            }
          >
            {t('mod.warp')}
          </button>
        </div>

        <div style={rowWrap}>
          <input
            style={{ ...input, flex: 1 }}
            type="number"
            placeholder={t('editor.spriteId')}
            value={spriteId}
            onChange={(e) => setSpriteId(+e.target.value)}
          />
          <button
            style={btn}
            onClick={() =>
              run(
                () => modSetSprite(name, spriteId),
                t('gm.spriteSet'),
                t('gm.failed'),
              )
            }
          >
            {t('gm.setSprite')}
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
                    t('gm.accessSet'),
                    t('gm.failed'),
                  )
                }
              >
                {t('gm.setAccess')}
              </button>
            </div>

            <div style={banBox}>
              <input
                style={input}
                placeholder={t('mod.banReason')}
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
              />
              <div style={rowWrap}>
                <input
                  style={{ ...input, flex: 1 }}
                  type="number"
                  placeholder={t('mod.banMinutes')}
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
                      t('mod.banned'),
                      t('mod.banFailed'),
                      true,
                    )
                  }
                >
                  {t('mod.ban')}
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
  background: colors.dangerMuted,
  border: `1px solid ${colors.danger}`,
  borderRadius: radius.sm,
  padding: 10,
};
