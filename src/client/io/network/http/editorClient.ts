import type { MapStateClient, MapType } from '../../../../shared/types';
import { httpClient } from './httpClient';
import { silentAction } from './authClient';
import { getGameState } from '../../../core/gameState';

export async function openMapEditor(): Promise<boolean> {
  const res = await silentAction(
    httpClient('/openMapEditor', { method: 'POST' }),
  );
  return !!res;
}

export async function openModEditor(): Promise<boolean> {
  const res = await silentAction(
    httpClient('/openModEditor', { method: 'POST' }),
  );
  return !!res;
}

export async function openContentEditor(): Promise<boolean> {
  const res = await silentAction(
    httpClient('/openContentEditor', { method: 'POST' }),
  );
  return !!res;
}

export const saveMap = async (
  newMapTiles: MapStateClient['tiles'],
  name: string,
  type: MapType,
) => {
  const mapData = {
    mapId: getGameState()?.id,
    tiles: newMapTiles,
    name,
    type,
  };

  return httpClient<Response>('/saveMap', {
    method: 'POST',
    body: mapData,
  });
};

export const fetchMaps = async (): Promise<MapStateClient[]> => {
  return (await httpClient<MapStateClient[]>('/maps', { method: 'GET' })) || [];
};

export const fetchMap = async (
  mapId: string,
): Promise<MapStateClient | null> => {
  return httpClient<MapStateClient>(`/maps/${mapId}`, {
    method: 'GET',
  });
};

export const updateMap = async (
  id: string,
  map: Partial<MapStateClient>,
): Promise<MapStateClient | null> => {
  return httpClient<MapStateClient>(`/maps/${id}`, {
    method: 'PUT',
    body: map,
  });
};

export const createMap = async (data: {
  name: string;
  type: MapType;
  cols?: number;
  rows?: number;
}): Promise<MapStateClient | null> => {
  return httpClient<MapStateClient>(`/maps`, {
    method: 'POST',
    body: data,
  });
};

export const modMoveMap = async (mapId: string) =>
  httpClient<Response>('/mod/gomap', {
    method: 'POST',
    body: { mapId },
  });
