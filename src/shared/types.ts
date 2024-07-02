// shared/types.ts
export enum Key {
  ArrowUp = 'ArrowUp',
  ArrowDown = 'ArrowDown',
  ArrowLeft = 'ArrowLeft',
  ArrowRight = 'ArrowRight',
  Shift = 'Shift',
  Control = 'Control',
  z = 'z',
}

export enum Direction {
  Down = 0,
  Left = 1,
  Right = 2,
  Up = 3,
}

export enum PlayerAction {
  Idle = 1,
  Walk = 0,
  Attack = 0,
}

export enum Protocol {
  HTTP,
  WS,
}

export const keyRecord: Record<Key, Protocol> = {
  ArrowUp: Protocol.WS,
  ArrowDown: Protocol.WS,
  ArrowLeft: Protocol.WS,
  ArrowRight: Protocol.WS,
  Shift: Protocol.WS,
  Control: Protocol.WS,
  z: Protocol.HTTP,
};

export interface KeyboardAction {
  key: Key;
  type: 'press' | 'release';
}

export interface ClientAction {
  username: string;
  keyboardAction: KeyboardAction;
}

export type ActionQueue = Array<ClientAction>;
export interface Character {
  id: string;
  position: Position;
  width: number;
  height: number;
  color: string;
  sprite: number;
  direction: Direction;
  action: PlayerAction;
}

export interface Position {
  x: number;
  y: number;
}

export interface Player extends Character {
  name: string;
  color: string;
  speed: number;
  attack: number;
  level: number;
  experience: number;
  experienceToNextLevel: number;
  attackRange: number;
  mapId: MapState['id'];
}

export type PlayersMap = { [key: string]: Player };

export type EnemiesMap = { [key: string]: Enemy };

export interface Enemy extends Character {
  health: number;
  experienceValue: number;
}

export interface GameState {
  maps: Record<string, MapState>;
}

export interface MapState {
  id: string;
  players: Record<string, Player>;
  enemies: Record<string, Enemy>;
  tiles: number[][];
}

export interface HttpRequestOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: any;
}
