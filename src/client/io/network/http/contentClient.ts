import type {
  RuntimeNpc,
  Item,
  Shop,
  ProductRaw,
  ProductDetailed,
} from '../../../../shared/types';
import { httpClient } from './httpClient';

export const fetchNpcs = async (): Promise<RuntimeNpc[]> => {
  return (await httpClient<RuntimeNpc[]>('/npcs', { method: 'GET' })) || [];
};

export const createNpc = async (
  npc: Pick<
    RuntimeNpc,
    'name' | 'sprite' | 'maxHealth' | 'attack' | 'behavior' | 'experienceValue'
  >,
): Promise<RuntimeNpc | null> => {
  return httpClient<RuntimeNpc>('/npcs', {
    method: 'POST',
    body: npc,
  });
};

export const updateNpc = async (
  id: string,
  npc: Partial<RuntimeNpc>,
): Promise<RuntimeNpc | null> => {
  return httpClient<RuntimeNpc>(`/npcs/${id}`, {
    method: 'PUT',
    body: npc,
  });
};

export const deleteNpc = async (id: string): Promise<void> => {
  await httpClient(`/npcs/${id}`, {
    method: 'DELETE',
  });
};

export const fetchItems = async (): Promise<Item[]> => {
  return (await httpClient<Item[]>('/items', { method: 'GET' })) || [];
};

export const createItem = async (
  item: Omit<Item, 'id'>,
): Promise<Item | null> => {
  return httpClient<Item>('/items', {
    method: 'POST',
    body: item,
  });
};

export const updateItem = async (
  id: number,
  item: Partial<Item>,
): Promise<Item | null> => {
  return httpClient<Item>(`/items/${id}`, {
    method: 'PUT',
    body: item,
  });
};

export const deleteItem = async (id: number): Promise<void> => {
  await httpClient(`/items/${id}`, {
    method: 'DELETE',
  });
};

export const fetchShops = async (): Promise<Shop<ProductRaw>[]> => {
  const result = await httpClient<Shop<ProductRaw>[]>('/shops', {
    method: 'GET',
  });
  return Array.isArray(result) ? result : [];
};

export const fetchShop = async (
  shopId: string,
): Promise<Shop<ProductDetailed> | null> => {
  return httpClient<Shop<ProductDetailed>>(`/shop/${shopId}`, {
    method: 'GET',
  });
};

export const changeSprite = async (spriteId: number) => {
  return httpClient<Response>('/mod/changeSprite', {
    method: 'POST',
    body: { spriteId },
  });
};
