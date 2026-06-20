import React, { useEffect, useState } from 'react';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { assignPointsPlayer } from '../io/network';
import { Modal } from './common/Modal';
import { colors, radius } from '../theme';

export const AttributeDistributorModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [atk, setAtk] = useState(0);
  const [vit, setVit] = useState(0);
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

  const remaining = player.unspentPoints - (atk + vit);

  const adjustAtk = (delta: number) =>
    setAtk((prev) =>
      Math.max(0, Math.min(prev + delta, player.unspentPoints - vit)),
    );
  const adjustVit = (delta: number) =>
    setVit((prev) =>
      Math.max(0, Math.min(prev + delta, player.unspentPoints - atk)),
    );

  const handleConfirm = async () => {
    if (remaining < 0) {
      setError('Too many points assigned');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await assignPointsPlayer(player.id, atk, vit);
      setAtk(0);
      setVit(0);
    } catch (e: any) {
      setError(e.message || 'Failed to assign points');
    } finally {
      setLoading(false);
    }
  };

  const stats = [
    {
      label: 'Attack',
      base: player.attack,
      delta: atk,
      setDelta: setAtk,
      adjust: adjustAtk,
    },
    {
      label: 'Vitality',
      base: player.vitality,
      delta: vit,
      setDelta: setVit,
      adjust: adjustVit,
    },
  ];

  return (
    <Modal title="Attributes" onClose={() => setVisible(false)} width={380}>
      <div style={layout}>
        <div style={badge(player.unspentPoints > 0)}>
          {player.unspentPoints} unspent point
          {player.unspentPoints !== 1 ? 's' : ''}
        </div>

        {stats.map(({ label, base, delta, setDelta, adjust }) => (
          <div key={label} style={statRow}>
            <span style={statLabel}>{label}</span>
            <span style={statBase}>{base}</span>
            <div style={stepper}>
              <button
                style={{ ...stepBtn, opacity: delta === 0 ? 0.4 : 1 }}
                onClick={() => adjust(-1)}
                disabled={delta === 0}
              >
                −
              </button>
              <input
                style={stepInput}
                type="number"
                min={0}
                value={delta}
                onChange={(e) => {
                  const v = Math.max(0, parseInt(e.target.value || '0'));
                  const other = setDelta === setAtk ? vit : atk;
                  setDelta(Math.min(v, player.unspentPoints - other));
                }}
              />
              <button
                style={{ ...stepBtn, opacity: remaining <= 0 ? 0.4 : 1 }}
                onClick={() => adjust(1)}
                disabled={remaining <= 0}
              >
                +
              </button>
            </div>
            <span style={arrow}>→</span>
            <span style={result(delta > 0)}>{base + delta}</span>
          </div>
        ))}

        <div style={remainingText(remaining)}>
          {remaining >= 0
            ? `${remaining} point${remaining !== 1 ? 's' : ''} remaining`
            : `${Math.abs(remaining)} point${Math.abs(remaining) !== 1 ? 's' : ''} over budget`}
        </div>

        {error && <p style={errorStyle}>{error}</p>}

        <button
          style={confirmBtn(loading || atk + vit === 0 || remaining < 0)}
          onClick={handleConfirm}
          disabled={loading || atk + vit === 0 || remaining < 0}
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
  gap: 14,
};

const badge = (active: boolean): React.CSSProperties => ({
  background: active ? '#e8fdf0' : colors.surfaceMuted,
  color: active ? colors.success : colors.textMuted,
  border: `1px solid ${active ? colors.success : colors.border}`,
  borderRadius: radius.md,
  padding: '8px 14px',
  fontWeight: 700,
  fontSize: 15,
  textAlign: 'center',
});

const statRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
};

const statLabel: React.CSSProperties = {
  width: 68,
  fontWeight: 600,
  fontSize: 14,
  color: colors.text,
};

const statBase: React.CSSProperties = {
  width: 32,
  textAlign: 'right',
  fontWeight: 700,
  fontSize: 18,
  color: colors.textMuted,
};

const stepper: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flex: 1,
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
