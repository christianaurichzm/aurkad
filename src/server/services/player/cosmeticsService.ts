import { PlayerServer } from '../../../shared/types.js';

// Derived cosmetics. Instead of setting nameColor/nameTag directly, where
// the last writer wins, systems contribute a named, prioritized source and
// the highest priority is written into the serialized field, so VIP, guild,
// PK flag and titles do not clobber one another.

export type CosmeticField = 'nameColor' | 'nameTag';

interface Contribution {
  value: string;
  priority: number;
}

function sourcesFor(
  player: PlayerServer,
  field: CosmeticField,
): Record<string, Contribution> {
  const bag = (player.cosmetics ??= {});
  return (bag[field] ??= {});
}

function resolve(player: PlayerServer, field: CosmeticField): void {
  const sources = player.cosmetics?.[field];
  let bestValue: string | undefined;
  let bestPriority = -Infinity;
  for (const source in sources) {
    const c = sources[source]!;
    if (c.priority >= bestPriority) {
      bestPriority = c.priority;
      bestValue = c.value;
    }
  }
  player[field] = bestValue;
}

// Contribute a value to a cosmetic field from a named source. Higher priority
// wins; equal priority resolves to the most recently set.
export function setCosmetic(
  player: PlayerServer,
  field: CosmeticField,
  source: string,
  value: string,
  priority = 0,
): void {
  sourcesFor(player, field)[source] = { value, priority };
  resolve(player, field);
}

// Withdraw a source's contribution; the field falls back to the next highest.
export function clearCosmetic(
  player: PlayerServer,
  field: CosmeticField,
  source: string,
): void {
  const sources = player.cosmetics?.[field];
  if (sources) delete sources[source];
  resolve(player, field);
}
