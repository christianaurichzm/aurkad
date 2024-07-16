// shared/utils.ts
import { Position } from './types';

export const getRandomPosition = (positions: Position[]): Position | null => {
  if (positions.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * positions.length);
  return positions[randomIndex];
};
