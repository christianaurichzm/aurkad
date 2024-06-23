// shared/types.ts
export enum MessageType {
  INIT = 'init',
  GAME_STATE = 'gameState',
  PLAYER_UPDATE = 'playerUpdate',
  ATTACK = 'attack',
}

export enum Key {
  ArrowUp = 'ArrowUp',
  ArrowDown = 'ArrowDown',
  ArrowLeft = 'ArrowLeft',
  ArrowRight = 'ArrowRight',
  Shift = 'Shift',
  Control = 'Control',
}

export interface Character {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface Player extends Character {
  color: string;
  speed: number;
  attack: number;
  level: number;
  experience: number;
  experienceToNextLevel: number;
  attackRange: number;
  mapId: GameMap['id'];
}

export type PlayersMap = { [key: string]: Player };

export type EnemiesMap = { [key: string]: Enemy };

export interface Enemy extends Character {
  health: number;
  experienceValue: number;
}

export interface GameState {
  type: MessageType.GAME_STATE;
  players: PlayersMap;
  enemies: EnemiesMap;
  map: GameMap;
}

export interface GameMap {
  id: string;
  background: string;
  players: PlayersMap;
  enemies: EnemiesMap;
}

export interface InitMessage {
  type: MessageType.INIT;
  playerId: string;
  map: GameMap;
}

export interface PlayerUpdateMessage {
  type: MessageType.PLAYER_UPDATE;
  player: Player;
}

export interface AttackMessage {
  type: MessageType.ATTACK;
  player: Player;
}

export type ServerMessage =
  | InitMessage
  | GameState
  | PlayerUpdateMessage
  | AttackMessage;
