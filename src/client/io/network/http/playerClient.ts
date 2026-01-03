import { httpClient } from './httpClient';

export const assignPointsPlayer = async (
  id: string,
  attack: number,
  vitality: number,
): Promise<void> => {
  await httpClient(`/players/${id}/assignPoints`, {
    method: 'POST',
    body: { attack, vitality },
  });
};
