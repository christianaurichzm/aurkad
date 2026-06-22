import React, { useEffect, useState } from 'react';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { assignPointsPlayer } from '../io/network';
import { Modal } from './common/Modal';
import { colors, radius } from '../theme';

type AttributeKey = 'strength' | 'defense' | 'vitality' | 'agility';
type QueuedAttributes = Record<AttributeKey, number>;

const emptyQueued: QueuedAttributes = {
  strength: 0,
  defense: 0,
  vitality: 0,
  agility: 0,
};

export const AttributeDistributorModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [queued, setQueued] = useState<QueuedAttributes>(emptyQueued);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const player = usePlayerForceUpdate(visible);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleAttributeDistributor', onToggle);
    return () =>
      window.removeEventListener('toggleAttributeDistributor', onToggle);
  }, []);

  if (!player || !visible) return null;

  const assigned = Object.values(queued).reduce((sum, value) => sum + value, 0);
  const remaining = player.unspentPoints - assigned;

  const setAttribute = (key: AttributeKey, value: number) =>
    setQueued((prev) => {
      const otherAssigned =
        Object.entries(prev).reduce((sum, [entryKey, entryValue]) => {
          return entryKey === key ? sum : sum + entryValue;
        }, 0);
      return {
        ...prev,
        [key]: Math.max(
          0,
          Math.min(value, player.unspentPoints - otherAssigned),
        ),
      };
    });

  const adjustAttribute = (key: AttributeKey, delta: number) =>
    setAttribute(key, queued[key] + delta);

  const handleConfirm = async () => {
    if (remaining < 0) {
      setError('Too many points assigned');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await assignPointsPlayer(player.id, queued);
      setQueued({ ...emptyQueued });
    } catch (e: any) {
      setError(e.message || 'Failed to assign points');
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    {
      key: 'strength' as const,
      label: 'Strength',
    },
    {
      key: 'defense' as const,
      label: 'Defense',
    },
    {
      key: 'vitality' as const,
      label: 'Vitality',
    },
    {
      key: 'agility' as const,
      label: 'Agility',
    },
  ];

  return (
    <Modal title="Attributes" onClose={() => setVisible(false)} width={460}>
      <div style={layout}>
        <div style={summaryGrid}>
          <div style={summaryCard(player.unspentPoints > 0)}>
            <span style={summaryLabel}>Available</span>
            <strong style={summaryValue(player.unspentPoints > 0)}>
              {player.unspentPoints}
            </strong>
          </div>
          <div style={summaryCard(assigned > 0)}>
            <span style={summaryLabel}>Queued</span>
            <strong style={summaryValue(assigned > 0)}>{assigned}</strong>
          </div>
        </div>

        <div style={statsList}>
          {stats.map(({ key, label }) => {
            const base = player[key];
            const delta = queued[key];
            return (
              <div key={label} style={statRow}>
                <span style={statLabel}>{label}</span>
                <span style={statBase}>{base}</span>
                <div style={stepper}>
                  <button
                    style={{ ...stepBtn, opacity: delta === 0 ? 0.4 : 1 }}
                    onClick={() => adjustAttribute(key, -1)}
                    disabled={delta === 0}
                    title={`Decrease ${label}`}
                  >
                    −
                  </button>
                  <input
                    style={stepInput}
                    type="number"
                    min={0}
                    value={delta}
                    aria-label={`${label} points`}
                    onChange={(e) => {
                      const v = Math.max(0, parseInt(e.target.value || '0'));
                      setAttribute(key, v);
                    }}
                  />
                  <button
                    style={{ ...stepBtn, opacity: remaining <= 0 ? 0.4 : 1 }}
                    onClick={() => adjustAttribute(key, 1)}
                    disabled={remaining <= 0}
                    title={`Increase ${label}`}
                  >
                    +
                  </button>
                </div>
                <span style={arrow}>→</span>
                <span style={result(delta > 0)}>{base + delta}</span>
              </div>
            );
          })}
        </div>

        <div style={remainingText(remaining)}>
          {remaining >= 0
            ? `${remaining} point${remaining !== 1 ? 's' : ''} remaining`
            : `${Math.abs(remaining)} point${Math.abs(remaining) !== 1 ? 's' : ''} over budget`}
        </div>

        {error && <p style={errorStyle}>{error}</p>}

        <button
          style={confirmBtn(loading || assigned === 0 || remaining < 0)}
          onClick={handleConfirm}
          disabled={loading || assigned === 0 || remaining < 0}
        >
          {loading ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
};

const layout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};

const summaryGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
};

const summaryCard = (active: boolean): React.CSSProperties => ({
  background: active ? '#e8fdf0' : colors.surfaceMuted,
  border: `1px solid ${active ? colors.success : colors.border}`,
  borderRadius: radius.lg,
  padding: '10px 12px',
  minHeight: 54,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
});

const summaryLabel: React.CSSProperties = {
  color: colors.textMuted,
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
};

const summaryValue = (active: boolean): React.CSSProperties => ({
  color: active ? colors.success : colors.textMuted,
  fontSize: 22,
  lineHeight: 1,
});

const statsList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const statRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(58px, 76px) 30px minmax(84px, 1fr) 14px 34px',
  alignItems: 'center',
  gap: 8,
  padding: '2px 0',
};

const statLabel: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 14,
  color: colors.text,
};

const statBase: React.CSSProperties = {
  textAlign: 'right',
  fontWeight: 700,
  fontSize: 18,
  color: colors.textMuted,
};

const stepper: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
};

const stepBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  border: `1px solid ${colors.border}`,
  background: colors.surface,
  borderRadius: radius.sm,
  cursor: 'pointer',
  fontSize: 16,
  fontWeight: 700,
  color: colors.text,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
  flexShrink: 0,
};

const stepInput: React.CSSProperties = {
  flex: 1,
  textAlign: 'center',
  padding: '4px 0',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 14,
  fontWeight: 600,
  minWidth: 0,
};

const arrow: React.CSSProperties = {
  color: colors.textMuted,
  fontSize: 16,
  flexShrink: 0,
};

const result = (hasBonus: boolean): React.CSSProperties => ({
  width: 36,
  textAlign: 'right',
  fontWeight: 700,
  fontSize: 18,
  color: hasBonus ? colors.success : colors.text,
});

const remainingText = (n: number): React.CSSProperties => ({
  fontSize: 13,
  fontWeight: 600,
  color: n < 0 ? colors.danger : colors.textMuted,
  textAlign: 'center',
  padding: '2px 0',
});

const errorStyle: React.CSSProperties = {
  color: colors.danger,
  fontSize: 13,
  margin: 0,
};

const confirmBtn = (disabled: boolean): React.CSSProperties => ({
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '10px 16px',
  borderRadius: radius.md,
  cursor: disabled ? 'not-allowed' : 'pointer',
  fontWeight: 600,
  fontSize: 14,
  opacity: disabled ? 0.5 : 1,
  width: '100%',
});
