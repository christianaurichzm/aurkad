import { useEffect, useState } from 'react';
import { Player } from '../../shared/types';
import { getPlayer } from '../core/gameState';

const POLL_MS = 300;

// Read on every render, so a panel shows the player it opens on; the timer
// only keeps it re-rendering while it stays open.
export function usePlayerForceUpdate(active: boolean = true): Player | null {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;

    const interval = setInterval(() => setTick((t) => t + 1), POLL_MS);

    return () => clearInterval(interval);
  }, [active]);

  return getPlayer();
}
