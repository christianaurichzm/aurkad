import type {
  MapStateClient,
  MapType,
  MapOrientation,
} from '../../../../shared/types';
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

export interface SaveMapResponse {
  success: boolean;
  warnings: string[];
}

export interface SaveMapError {
  errors: string[];
}

export const saveMap = async (
  newMapTiles: MapStateClient['tiles'],
  name: string,
  type: MapType,
  music?: string,
  mapId?: string,
): Promise<SaveMapResponse | null> => {
  const mapData = {
    mapId: mapId ?? getGameState()?.id,
    tiles: newMapTiles,
    name,
    type,
    music: music || undefined,
  };

  return httpClient<SaveMapResponse>('/saveMap', {
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
  orientation?: MapOrientation;
  cols?: number;
  rows?: number;
}): Promise<MapStateClient | null> => {
  return httpClient<MapStateClient>(`/maps`, {
    method: 'POST',
    body: data,
  });
};

export const resizeMap = async (
  id: string,
  cols: number,
  rows: number,
): Promise<{ success: boolean; cols: number; rows: number } | null> =>
  httpClient(`/maps/${id}/resize`, { method: 'POST', body: { cols, rows } });

export const modMoveMap = async (mapId: string) =>
  httpClient<Response>('/mod/gomap', {
    method: 'POST',
    body: { mapId },
  });
