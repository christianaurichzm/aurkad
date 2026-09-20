import {
  CharacterAction,
  Access,
  Key,
  Protocol,
  NpcBehavior,
} from './types.js';

export const playerActionToActionColumnRecord: Record<CharacterAction, number> =
  {
    [CharacterAction.Idle]: 0,
    [CharacterAction.Walk]: 2,
    [CharacterAction.Attack]: 2,
    [CharacterAction.Run]: 2,
  };

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

export const imageMap: Record<string, string> = {
  tiles: 'tiles',
  sprites: 'sprites',
  items: 'items',
  spells: 'spells',
  arrows: 'arrows',
  attackeffect: 'attackeffect',
};
