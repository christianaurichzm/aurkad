import React, { useEffect, useState } from 'react';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { assignPointsPlayer, httpError } from '../io/network';
import { Modal } from './common/Modal';
import { EmptyState } from './common/EmptyState';
import { useT, type TranslationKey } from '../i18n';
import { useGameBrand } from './common/AuthLayout';

type AttributeKey = 'strength' | 'defense' | 'vitality' | 'agility';
type QueuedAttributes = Record<AttributeKey, number>;

const emptyQueued: QueuedAttributes = {
  strength: 0,
  defense: 0,
  vitality: 0,
  agility: 0,
};

// Keys spelled out: the table's own test looks each one up in the source.
const ATTRIBUTES: {
  key: AttributeKey;
  label: TranslationKey;
  hint: TranslationKey;
}[] = [
  {
    key: 'strength',
    label: 'attributes.strength',
    hint: 'attributes.strengthHint',
  },
  {
    key: 'defense',
    label: 'attributes.defense',
    hint: 'attributes.defenseHint',
  },
  {
    key: 'vitality',
    label: 'attributes.vitality',
    hint: 'attributes.vitalityHint',
  },
  {
    key: 'agility',
    label: 'attributes.agility',
    hint: 'attributes.agilityHint',
  },
];

export const AttributeDistributorModal: React.FC = () => {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [queued, setQueued] = useState<QueuedAttributes>(emptyQueued);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const player = usePlayerForceUpdate(visible);
  const game = useGameBrand();

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleAttributeDistributor', onToggle);
    return () =>
      window.removeEventListener('toggleAttributeDistributor', onToggle);
  }, []);

  // V still reaches here in a game without attribute points.
  if (!player || !visible || game?.attributes === false) return null;

  const assigned = Object.values(queued).reduce((sum, value) => sum + value, 0);
  const remaining = player.unspentPoints - assigned;

  const adjust = (key: AttributeKey, delta: number) =>
    setQueued((prev) => ({ ...prev, [key]: prev[key] + delta }));

  const handleConfirm = async () => {
    setLoading(true);
    setError('');
    try {
      await assignPointsPlayer(player.id, queued);
      setQueued({ ...emptyQueued });
    } catch (e) {
      setError(httpError(e).message || t('attributes.assignFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Two keys rather than a plural rule, since the table has none.
  const count = (one: TranslationKey, many: TranslationKey, n: number) =>
    t(n === 1 ? one : many, { count: n });

  const readOnly = player.unspentPoints === 0;

  return (
    <Modal
      floating
      size="regular"
      anchor="right"
      title={t('attributes.title')}
      onClose={() => setVisible(false)}
      footer={
        readOnly ? (
          <EmptyState
            icon="stats"
            title={t('attributes.noPoints')}
            hint={t('attributes.levelUp')}
          />
        ) : (
          <div className="window-actions">
            <button
              type="button"
              disabled={assigned === 0 || loading}
              onClick={() => setQueued({ ...emptyQueued })}
            >
              {t('attributes.reset')}
            </button>
            <button
              type="button"
              className="button-primary"
              onClick={handleConfirm}
              disabled={loading || assigned === 0}
            >
              {loading
                ? t('attributes.saving')
                : assigned === 0
                  ? t('attributes.confirm')
                  : count(
                      'attributes.confirmPoint',
                      'attributes.confirmPoints',
                      assigned,
                    )}
            </button>
          </div>
        )
      }
    >
      <div className="attr-points" aria-live="polite">
        <span className="attr-points-number">{remaining}</span>
        <span className="attr-points-label">
          {count('attributes.unspentOne', 'attributes.unspent', remaining)}
        </span>
      </div>
      <ul className="attr-list">
        {ATTRIBUTES.map(({ key, label: labelKey, hint }) => {
          const label = t(labelKey);
          const base = player[key];
          const delta = queued[key];
          return (
            <li
              key={key}
              className="attr-row"
              data-pending={delta > 0 || undefined}
            >
              <div>
                <h3>{label}</h3>
                <p>{t(hint)}</p>
              </div>
              <div
                className="attr-value"
                aria-label={t(
                  delta ? 'attributes.change' : 'attributes.value',
                  {
                    stat: label,
                    from: base,
                    to: base + delta,
                  },
                )}
              >
                {delta > 0 ? (
                  <>
                    <span className="attr-value-old">{base}</span>
                    <span aria-hidden="true">→</span>
                    <b>{base + delta}</b>
                  </>
                ) : (
                  <b>{base}</b>
                )}
              </div>
              {!readOnly && (
                <div className="attr-buttons">
                  <button
                    type="button"
                    className="step-button"
                    onClick={() => adjust(key, -1)}
                    disabled={delta === 0}
                    aria-label={t('attributes.decrease', { stat: label })}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="step-button"
                    onClick={() => adjust(key, 1)}
                    disabled={remaining === 0}
                    aria-label={t('attributes.increase', { stat: label })}
                  >
                    +
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="window-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
};
