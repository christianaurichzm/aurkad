import { Key, MessageType, Player } from '../../shared/types';
import { keys, previousKeyState } from '../io/keyboard';
import { sendPlayerMessage } from '../io/network';

let _player: Player;

export const setPlayer = (player: Player) => {
  _player = player;
};

export const getPlayer = (): Player => {
  return _player;
};

const BASE_SPEED = 50;
const BOOST_MULTIPLIER = 4;

const updatePlayerPosition = (player: Player, deltaTime: number) => {
  const speed = player.speed * (deltaTime / 1000);

  if (keys[Key.ArrowUp]) player.y -= speed;
  if (keys[Key.ArrowDown]) player.y += speed;
  if (keys[Key.ArrowLeft]) player.x -= speed;
  if (keys[Key.ArrowRight]) player.x += speed;
};

const handleBoost = (player: Player) => {
  if (keys[Key.Shift] && !previousKeyState[Key.Shift]) {
    player.speed *= BOOST_MULTIPLIER;
    previousKeyState[Key.Shift] = true;
  }
  if (!keys[Key.Shift] && previousKeyState[Key.Shift]) {
    player.speed = BASE_SPEED;
    previousKeyState[Key.Shift] = false;
  }
};

const handleAttack = (player: Player) => {
  if (keys[Key.Control] && !previousKeyState[Key.Control]) {
    sendPlayerMessage({ type: MessageType.ATTACK, player });
    previousKeyState[Key.Control] = true;
  }
  if (!keys[Key.Control] && previousKeyState[Key.Control]) {
    previousKeyState[Key.Control] = false;
  }
};

export const update = (deltaTime: number) => {
  const player = getPlayer();

  if (player) {
    handleBoost(player);
    updatePlayerPosition(player, deltaTime);
    sendPlayerMessage({ type: MessageType.PLAYER_UPDATE, player });
    handleAttack(player);
  }
};
