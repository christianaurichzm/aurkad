import React, { useEffect, useState } from 'react';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { assignPointsPlayer, httpClient } from '../io/network';

export const AttributeDistributorModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [attack, setAttack] = useState(0);
  const [vitality, setVitality] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const player = usePlayerForceUpdate(visible);
  console.log(player);
  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleAttributeDistributor', onToggle);
    return () =>
      window.removeEventListener('toggleAttributeDistributor', onToggle);
  }, []);

  if (!player || !visible) return null;

  const remaining = player.unspentPoints - (attack + vitality);

  const assignPoints = async () => {
    if (remaining < 0) {
      setError('Too many points assigned');
      return;
    }
    setLoading(true);
    setError('');

    try {
      await assignPointsPlayer(player.id, attack, vitality);
      setAttack(0);
      setVitality(0);
    } catch (e: any) {
      setError(e.message || 'Failed to assign points');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.panel}>
        <div style={styles.title}>Attributes</div>

        <div style={styles.row}>
          <label>
            Attack: {player.attack} + {attack}
          </label>
          <input
            type="number"
            min={0}
            value={attack}
            onChange={(e) => setAttack(parseInt(e.target.value || '0'))}
          />
        </div>

        <div style={styles.row}>
          <label>
            Vitality: {player.vitality} + {vitality}
          </label>
          <input
            type="number"
            min={0}
            value={vitality}
            onChange={(e) => setVitality(parseInt(e.target.value || '0'))}
          />
        </div>

        <p>
          Unspent: {player.unspentPoints} | Remaining: {remaining}
        </p>
        {error && <p style={styles.error}>{error}</p>}

        <div style={styles.row}>
          <button
            onClick={assignPoints}
            disabled={loading || attack + vitality === 0}
          >
            {loading ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

const styles = {
  container: {
    position: 'absolute' as const,
    top: 100,
    right: 100,
    backgroundColor: '#222',
    border: '2px solid #444',
    padding: 16,
    borderRadius: 8,
    color: '#fff',
    zIndex: 999,
  },
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold' as const,
  },
  row: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 4,
  },
  error: {
    color: 'red',
  },
};
