import { CharacterAction, Access, Key, Protocol } from './types';

export const playerActionToActionColumnRecord: Record<CharacterAction, number> =
  {
    [CharacterAction.Idle]: 0,
    [CharacterAction.Walk]: 2,
    [CharacterAction.Attack]: 2,
  };

export const playerNameColorRecord: Record<Access, string> = {
  [Access.USER]: 'yellow',
  [Access.MOD]: 'blue',
  [Access.ADMIN]: 'black',
};

export const keyRecord: Partial<Record<Key, Protocol>> = {
  ArrowUp: Protocol.WS,
  ArrowDown: Protocol.WS,
  ArrowLeft: Protocol.WS,
  ArrowRight: Protocol.WS,
  Shift: Protocol.WS,
  Control: Protocol.WS,
  e: Protocol.WS,
  c: Protocol.HTTP,
  x: Protocol.HTTP,
  z: Protocol.HTTP,
};

export const imageMap: Record<string, string> = {
  tiles: 'tiles',
  sprites: 'sprites',
  items: 'items',
};
