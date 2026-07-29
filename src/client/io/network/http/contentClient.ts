import type {
  RuntimeNpc,
  Item,
  Shop,
  ProductRaw,
  ProductDetailed,
  Spell,
  Arrow,
  LootTable,
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

export const createShop = async (
  data: Omit<Shop<ProductRaw>, never>,
): Promise<Shop<ProductRaw> | null> => {
  return httpClient<Shop<ProductRaw>>('/shops', { method: 'POST', body: data });
};

export const updateShop = async (
  id: string,
  data: Shop<ProductRaw>,
): Promise<void> => {
  await httpClient(`/shops/${id}`, { method: 'PUT', body: data });
};

export const deleteShop = async (id: string): Promise<void> => {
  await httpClient(`/shops/${id}`, { method: 'DELETE' });
};

export const changeSprite = async (spriteId: number) => {
  return httpClient<Response>('/mod/changeSprite', {
    method: 'POST',
    body: { spriteId },
  });
};

export const fetchSpells = async (): Promise<Spell[]> => {
  return (await httpClient<Spell[]>('/spells', { method: 'GET' })) ?? [];
};

export const createSpell = async (
  spell: Omit<Spell, 'id'>,
): Promise<Spell | null> => {
  return httpClient<Spell>('/spells', { method: 'POST', body: spell });
};

export const updateSpell = async (
  id: number,
  spell: Partial<Spell>,
): Promise<void> => {
  await httpClient(`/spells/${id}`, { method: 'PUT', body: spell });
};

export const deleteSpell = async (id: number): Promise<void> => {
  await httpClient(`/spells/${id}`, { method: 'DELETE' });
};

export const fetchArrows = async (): Promise<Arrow[]> => {
  return (await httpClient<Arrow[]>('/arrows', { method: 'GET' })) ?? [];
};

export const createArrow = async (
  arrow: Omit<Arrow, 'id'>,
): Promise<Arrow | null> => {
  return httpClient<Arrow>('/arrows', { method: 'POST', body: arrow });
};

export const updateArrow = async (
  id: number,
  arrow: Partial<Arrow>,
): Promise<void> => {
  await httpClient(`/arrows/${id}`, { method: 'PUT', body: arrow });
};

export const deleteArrow = async (id: number): Promise<void> => {
  await httpClient(`/arrows/${id}`, { method: 'DELETE' });
};

export const listLootTables = async (): Promise<LootTable[]> => {
  return (await httpClient<LootTable[]>('/loot', { method: 'GET' })) ?? [];
};

export const saveLootTable = async (
  table: LootTable,
): Promise<(LootTable & { warnings?: string[] }) | null> => {
  return httpClient<LootTable & { warnings?: string[] }>('/loot', {
    method: 'POST',
    body: table,
  });
};

export const deleteLootTable = async (id: string): Promise<void> => {
  await httpClient(`/loot/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
