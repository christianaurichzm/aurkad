import React, { useCallback, useEffect, useState } from 'react';
import { fetchAuditLog, type AuditRecord } from '../../io/network';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

// Read-only view of the audit trail; nothing edits or deletes it, here or
// on the server.
export const AuditLog: React.FC<{ height?: number }> = ({ height = 260 }) => {
  const t = useT();
  const [rows, setRows] = useState<AuditRecord[]>([]);
  const [actor, setActor] = useState('');
  const [deniedOnly, setDeniedOnly] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    fetchAuditLog({
      actor: actor.trim() || undefined,
      outcome: deniedOnly ? 'denied' : undefined,
      limit: 100,
    })
      .then(setRows)
      .catch(() => setError(t('audit.readFailed')));
  }, [actor, deniedOnly, t]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={controls}>
        <input
          style={input}
          placeholder={t('audit.filter')}
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        />
        <label style={checkbox}>
          <input
            type="checkbox"
            checked={deniedOnly}
            onChange={(e) => setDeniedOnly(e.target.checked)}
          />
          {t('audit.deniedOnly')}
        </label>
        <button style={refreshBtn} onClick={load}>
          {t('mod.refresh')}
        </button>
      </div>

      {error && <div style={errorLine}>{error}</div>}

      <div style={{ ...list, height }}>
        {rows.length === 0 && !error && (
          <div style={empty}>{t('audit.empty')}</div>
        )}
        {rows.map((row, i) => (
          <div key={`${row.at}-${i}`} style={rowStyle}>
            <span style={time}>
              {new Date(row.at).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'medium',
              })}
            </span>
            <span
              style={{
                ...badge,
                background:
                  row.outcome === 'denied'
                    ? colors.danger
                    : colors.surfaceMuted,
                color: row.outcome === 'denied' ? '#fff' : colors.textMuted,
              }}
            >
              {t(row.outcome === 'denied' ? 'audit.denied' : 'audit.allowed')}
            </span>
            <span style={who}>{row.actor ?? t('audit.anonymous')}</span>
            <span style={action}>{row.action}</span>
            {row.target && <span style={target}>{row.target}</span>}
            <span style={meta}>
              {row.source}
              {row.status ? ` · ${row.status}` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

const controls: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const input: React.CSSProperties = {
  flex: 1,
  padding: '6px 8px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 13,
  background: colors.surface,
};

const checkbox: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  color: colors.textMuted,
  whiteSpace: 'nowrap',
};

const refreshBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '6px 10px',
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const list: React.CSSProperties = {
  overflowY: 'auto',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  background: colors.surface,
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 8px',
  borderBottom: `1px solid ${colors.border}`,
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const time: React.CSSProperties = {
  color: colors.textMuted,
  fontVariantNumeric: 'tabular-nums',
};

const badge: React.CSSProperties = {
  borderRadius: radius.sm,
  padding: '1px 6px',
  fontSize: 11,
  fontWeight: 600,
};

const who: React.CSSProperties = { fontWeight: 600 };

const action: React.CSSProperties = {
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const target: React.CSSProperties = { color: colors.primary };

const meta: React.CSSProperties = { color: colors.textMuted, fontSize: 11 };

const empty: React.CSSProperties = {
  padding: 8,
  fontSize: 12,
  color: colors.textMuted,
};

const errorLine: React.CSSProperties = {
  fontSize: 12,
  color: colors.danger,
};
