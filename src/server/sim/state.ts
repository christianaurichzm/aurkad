import {
  GameState,
  PlayerServer,
  PlayersServerMap,
} from '../../shared/types.js';

export const runtimeState: GameState = {
  maps: {},
};

export const players: PlayersServerMap = {};

export const playersByName = new Map<string, PlayerServer>();
