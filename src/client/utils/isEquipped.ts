import type { Player } from '../../shared/types';

export const isEquipped = (p: Player, id: number) =>
  [
    p.equipped.weapon,
    p.equipped.helmet,
    p.equipped.chestplate,
    p.equipped.gloves,
    p.equipped.boots,
  ].some((eq) => eq?.id === id);
