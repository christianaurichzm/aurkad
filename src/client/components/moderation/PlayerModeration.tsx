import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchOnlinePlayers,
  modKick,
  modBan,
  modBring,
  modGoto,
  modWarp,
  modSetAccess,
  modSetMyAccess,
  modSetSprite,
} from '../../io/network';
import { Access } from '../../../shared/types';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

// Moderation shared by the GM panel and /admin. The name field is the
// target: type a name (offline players too) or click a row. Bring and Go To
// need the operator in the world. Acting on `self` sets access through
// setMyAccess, since setAccess would end the operator's own session.
export const PlayerModeration: React.FC<{
  access: Access;
  self?: string;
  allowRelativeTeleport?: boolean;
  onResult: (message: string) => void;
}> = ({ access, self, allowRelativeTeleport = false, onResult }) => {
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
  const [accessChoice, setAccessChoice] = useState<{
    name: string;
    level: Access;
  }>();

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

  const name = target.trim();
  // A picked row keeps the whole list in view, so switching target is a click.
  const filtered = players.includes(name)
    ? players
    : players.filter((p) => p.toLowerCase().includes(name.toLowerCase()));

  const hasTarget = name.length > 0;
  const isSelf = !!self && name === self;
  // No preselected level, so a careless click demotes nobody; picking
  // yourself starts on your own level, which changes nothing.
  const accessLevel =
    accessChoice?.name === name
      ? accessChoice.level
      : isSelf
        ? access
        : undefined;
  const canApplyAccess =
    accessLevel !== undefined && !(isSelf && accessLevel === access);

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
      <div style={searchRow}>
        <input
          style={{ ...input, flex: 1 }}
          aria-label={t('mod.targetPlaceholder')}
          placeholder={t('mod.targetPlaceholder')}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <button style={ghostBtn} onClick={() => void load()} disabled={loading}>
          {loading ? '…' : t('mod.refresh')}
        </button>
      </div>
      <span style={countLine}>{t('online.count', { count })}</span>

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
              {p === self && <span style={youTag}>{t('mod.you')}</span>}
            </li>
          ))
        )}
      </ul>

      {!hasTarget ? (
        <p style={hint}>{t('mod.pickHint')}</p>
      ) : (
        <>
          <fieldset style={group}>
            <legend style={legend}>{t('mod.groupTeleport')}</legend>
            {allowRelativeTeleport && !isSelf && (
              <div style={fieldRow}>
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
                    run(
                      () => modGoto(name),
                      t('mod.teleported'),
                      t('gm.failed'),
                    )
                  }
                >
                  {t('mod.goTo')}
                </button>
              </div>
            )}
            <div style={fieldRow}>
              <Field label={t('gm.mapId')} grow>
                <input
                  style={input}
                  value={warpMap}
                  onChange={(e) => setWarpMap(e.target.value)}
                />
              </Field>
              <Field label={t('questEditor.col')}>
                <input
                  style={{ ...input, width: 64 }}
                  type="number"
                  min={0}
                  value={warpCol}
                  onChange={(e) => setWarpCol(+e.target.value)}
                />
              </Field>
              <Field label={t('questEditor.row')}>
                <input
                  style={{ ...input, width: 64 }}
                  type="number"
                  min={0}
                  value={warpRow}
                  onChange={(e) => setWarpRow(+e.target.value)}
                />
              </Field>
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
          </fieldset>

          <fieldset style={group}>
            <legend style={legend}>{t('mod.groupCharacter')}</legend>
            <div style={fieldRow}>
              <Field label={t('editor.spriteId')} grow>
                <input
                  style={input}
                  type="number"
                  value={spriteId}
                  onChange={(e) => setSpriteId(+e.target.value)}
                />
              </Field>
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
              <div style={fieldRow}>
                <Field label={t('mod.accessLevel')} grow>
                  <select
                    style={input}
                    value={accessLevel ?? ''}
                    onChange={(e) =>
                      setAccessChoice({ name, level: +e.target.value })
                    }
                  >
                    <option value="" disabled>
                      {t('mod.pickLevel')}
                    </option>
                    {accessOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <button
                  style={btn}
                  disabled={!canApplyAccess}
                  onClick={() =>
                    accessLevel !== undefined &&
                    run(
                      () =>
                        isSelf
                          ? modSetMyAccess(accessLevel)
                          : modSetAccess(name, accessLevel),
                      t('gm.accessSet'),
                      t('gm.failed'),
                    )
                  }
                >
                  {t('gm.setAccess')}
                </button>
              </div>
            )}
          </fieldset>

          {!isSelf && (
            <fieldset style={dangerGroup}>
              <legend style={{ ...legend, color: colors.dangerText }}>
                {t('mod.groupPunish')}
              </legend>
              <div style={fieldRow}>
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
              </div>
              {canAdmin && (
                <>
                  <Field label={t('mod.banReason')}>
                    <input
                      style={input}
                      value={banReason}
                      onChange={(e) => setBanReason(e.target.value)}
                    />
                  </Field>
                  <div style={fieldRow}>
                    <Field label={t('mod.banMinutes')} grow>
                      <input
                        style={input}
                        type="number"
                        value={banDuration}
                        onChange={(e) => setBanDuration(+e.target.value)}
                      />
                    </Field>
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
                </>
              )}
            </fieldset>
          )}
        </>
      )}
    </div>
  );
};

const Field: React.FC<{
  label: string;
  grow?: boolean;
  children: React.ReactNode;
}> = ({ label, grow, children }) => (
  <label style={{ ...field, flex: grow ? 1 : undefined }}>
    <span style={fieldLabel}>{label}</span>
    {children}
  </label>
);

const wrap: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
const searchRow: React.CSSProperties = { display: 'flex', gap: 6 };
const countLine: React.CSSProperties = {
  color: colors.success,
  fontWeight: 700,
  fontSize: 12,
};
const ghostBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '5px 10px',
  borderRadius: radius.control,
  cursor: 'pointer',
  fontSize: 13,
  flexShrink: 0,
};
const list: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 150,
  overflowY: 'auto',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
};
const row = (sel: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 12px',
  cursor: 'pointer',
  borderBottom: `1px solid ${colors.border}`,
  background: sel ? colors.selected : 'transparent',
  boxShadow: sel ? `inset 3px 0 0 ${colors.primary}` : undefined,
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
const youTag: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 11,
  color: colors.textMuted,
};
const hint: React.CSSProperties = {
  margin: '4px 0 0',
  fontSize: 13,
  color: colors.textMuted,
  textAlign: 'center',
};
const group: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: 0,
  minWidth: 0,
  padding: '6px 10px 10px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
};
const dangerGroup: React.CSSProperties = {
  ...group,
  borderColor: colors.danger,
  background: colors.dangerMuted,
};
const legend: React.CSSProperties = {
  padding: '0 4px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: colors.textMuted,
};
const fieldRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 6,
};
const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  minWidth: 0,
};
const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  color: colors.textMuted,
};
const input: React.CSSProperties = {
  padding: '7px 9px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.control,
  outline: 'none',
  fontSize: 14,
  background: colors.surface,
  boxSizing: 'border-box',
  minWidth: 0,
  width: '100%',
};
const btn: React.CSSProperties = {
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '8px 14px',
  borderRadius: radius.control,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  flexShrink: 0,
};
const dangerBtn: React.CSSProperties = { ...btn, background: colors.danger };
