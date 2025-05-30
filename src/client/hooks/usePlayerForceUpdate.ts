import { useEffect, useState } from 'react';
import { Player } from '../../shared/types';
import { getPlayer } from '../core/gameState';

const POLL_MS = 300;

export function usePlayerForceUpdate(active: boolean = true) {
  const [, setTick] = useState(0);
  const [player, setPlayer] = useState<Player | null>(getPlayer());

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => {
      setPlayer(getPlayer());
      setTick((t) => t + 1);
    }, POLL_MS);

    return () => clearInterval(interval);
  }, [active]);

  return player;
}
