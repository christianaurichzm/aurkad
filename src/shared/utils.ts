import { Position } from './types.js';

export const getRandomPosition = (positions: Position[]): Position | null => {
  if (positions.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * positions.length);
  return positions[randomIndex];
};

export const capitalizeFirst = (s: string) => {
  return s.charAt(0).toUpperCase() + s.slice(1);
};
