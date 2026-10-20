import { PlayerServer } from '../../../shared/types.js';

// Derived cosmetics. Instead of setting nameColor/nameTag directly, where
// the last writer wins, systems contribute a named, prioritized source and
// the highest priority is written into the serialized field, so VIP, guild,
// PK flag and titles do not clobber one another.

export type CosmeticField = 'nameColor' | 'nameTag';

interface Contribution {
  value: string;
  priority: number;
  // nameTag only: the colour the tag is drawn in. It belongs to this
  // contribution, so a tag that wins is never shown in another source's colour.
  color?: string;
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
  let best: Contribution | undefined;
  for (const source in sources) {
    const c = sources[source]!;
    if (!best || c.priority >= best.priority) best = c;
  }
  player[field] = best?.value;
  if (field === 'nameTag') player.nameTagColor = best?.color;
}

// Contribute a value to a cosmetic field from a named source. Higher priority
// wins; equal priority resolves to the most recently set.
export function setCosmetic(
  player: PlayerServer,
  field: CosmeticField,
  source: string,
  value: string,
  priority = 0,
  color?: string,
): void {
  const sources = sourcesFor(player, field);
  // An object lists a key where it was first added, and the tie-break reads
  // that order as "most recently set": an update goes back to the end.
  delete sources[source];
  sources[source] = { value, priority, color };
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
