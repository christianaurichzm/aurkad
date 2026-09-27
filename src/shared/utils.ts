import type { MapType, PvpMorale } from './types.js';

export const capitalizeFirst = (s: string) => {
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// A map's PvP morale, deriving from `type` when unset (back-compat).
export const mapPvpMorale = (map: {
  type: MapType;
  pvp?: PvpMorale;
}): PvpMorale => map.pvp ?? (map.type === 'pvp' ? 'no-penalty' : 'safe');

export const mapAllowsPvp = (map: {
  type: MapType;
  pvp?: PvpMorale;
}): boolean => mapPvpMorale(map) !== 'safe';
