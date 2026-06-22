import { httpClient } from './httpClient';
import type { OnlinePlayersResponse } from '../../../../shared/types';

export const fetchOnlinePlayers = async (): Promise<OnlinePlayersResponse> => {
  const data = await httpClient<OnlinePlayersResponse>('/players/online', {
    method: 'GET',
  });

  return data ?? { players: [], count: 0 };
};

export const assignPointsPlayer = async (
  id: string,
  points: {
    vitality?: number;
    strength?: number;
    defense?: number;
    agility?: number;
    attack?: number;
  },
): Promise<void> => {
  await httpClient(`/players/${id}/assignPoints`, {
    method: 'POST',
    body: points,
  });
};
