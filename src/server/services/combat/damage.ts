// Normalizes a damage value coming out of the beforeDamage hook.
// Scripts may set NaN, a negative or Infinity, so it clamps to a finite >= 0.
export function clampDamage(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
