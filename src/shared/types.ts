// shared/types.ts
export enum MessageType {
  INIT = 'init',
  GAME_STATE = 'gameState',
  PLAYER_UPDATE = 'playerUpdate',
  ATTACK = 'attack',
}

export interface Player {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  speed: number;
  attack: number;
  level: number;
  experience: number;
  experienceToNextLevel: number;
  attackRange: number;
}

export interface Enemy {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  health: number;
  experienceValue: number;
}

export interface GameState {
  type: MessageType.GAME_STATE;
  players: { [key: string]: Player };
  enemies: Enemy[];
}

export interface InitMessage {
  type: MessageType.INIT;
  playerId: string;
  players: { [key: string]: Player };
  enemies: Enemy[];
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
