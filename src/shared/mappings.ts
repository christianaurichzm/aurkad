import { Access, Key, Protocol, NpcBehavior } from './types.js';

// Hex rather than css names so the hud can weigh the colour: a dark name is
// drawn with a halo instead of the outline a light one gets, and a browser is
// the only thing that turns `blue` into a number.
export const playerNameColorRecord: Record<Access, string> = {
  [Access.USER]: '#ffff00',
  [Access.MOD]: '#0000ff',
  [Access.ADMIN]: '#000000',
};

// Name color drawn above each NPC, so players can tell at a glance what an NPC
// is: enemies red, allies/pets green, shops blue, talk/quest NPCs and guards
// in calmer tones.
export const npcBehaviorColorRecord: Record<NpcBehavior, string> = {
  aggressive: '#ef4444', // red - attacks on sight (monster)
  hostile: '#f97316', // orange - fights back when provoked
  friendly: '#22c55e', // green - allies and pets
  shopkeeper: '#3b82f6', // blue - vendor
  guard: '#a855f7', // purple - town guard
  neutral: '#e5e7eb', // light grey - generic / dialog NPC
};

export const keyRecord: Partial<Record<Key, Protocol>> = {
  ArrowUp: Protocol.WS,
  ArrowDown: Protocol.WS,
  ArrowLeft: Protocol.WS,
  ArrowRight: Protocol.WS,
  Shift: Protocol.WS,
  Control: Protocol.WS,
  e: Protocol.WS,
  f: Protocol.WS,
  c: Protocol.HTTP,
  x: Protocol.HTTP,
  z: Protocol.HTTP,
};

/** The image sheets a client loads, each served as /assets/<name>.png. */
export const SHEETS = [
  'tiles',
  'sprites',
  'items',
  'spells',
  'arrows',
  'attackeffect',
] as const;

type SheetFrames = {
  width: number;
  height: number;
  columns: number;
  idleColumn: number;
  attackColumn: number;
  scale: number;
};

/**
 * The character sheets the admin's Art page takes as they come, each with the
 * sprites.json it is read by. `aurkad` is the README's 64 px grid; the
 * others are blocks of three frames over the same four rows (RPG Maker's
 * layout), walked 0-1-2-1 and scaled up to fill a 64 px cell.
 */
export const SPRITE_LAYOUTS: Record<
  'aurkad' | 'three-48' | 'three-32',
  Partial<SheetFrames>
> = {
  aurkad: {},
  'three-48': {
    width: 48,
    height: 48,
    columns: 3,
    idleColumn: 1,
    attackColumn: 2,
    scale: 4 / 3,
  },
  'three-32': {
    width: 32,
    height: 32,
    columns: 3,
    idleColumn: 1,
    attackColumn: 2,
    scale: 2,
  },
};
export type SpriteLayoutName = keyof typeof SPRITE_LAYOUTS;
