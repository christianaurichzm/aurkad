import {
  BOOST_MULTIPLIER,
  TILE_SIZE,
  DEFAULT_PLAYER_SPEED,
} from '../../shared/constants';
import {
  Key,
  Direction,
  PlayerAction,
  Player,
  ClientKeyboardAction,
  Tile,
  MapState,
  Shop,
  ProductRaw,
} from '../../shared/types';
import {
  getMap,
  updatePlayer,
  updateMapById,
  getGameStateDb,
  getPlayers,
  updateMap,
  getItems,
} from '../database';
import { playersWsMap, broadcast } from '../wsServer';
import { handleAttack } from './combatService';
import { pickUpItem } from './inventoryService';
import { insertModeCell, updatePlayerMap } from './mapService';
import { hasCollision, hasWarp } from './physicsService';
import { createPlayer, handlePlayerUpdates } from './playerService';

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

let isActing = false;

export const handleKeyPress = async (username: string, key: Key) => {
  if (isActing) return;
  isActing = true;

  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    const proposedState = { ...newState, position: { ...newState.position } };

    switch (key) {
      case Key.Shift:
        newState.speed *= BOOST_MULTIPLIER;
        break;
      case Key.ArrowUp:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Up,
          0,
          -TILE_SIZE,
        );
        break;
      case Key.ArrowDown:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Down,
          0,
          TILE_SIZE,
        );
        break;
      case Key.ArrowLeft:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Left,
          -TILE_SIZE,
          0,
        );
        break;
      case Key.ArrowRight:
        updatePlayerPositionAndDirection(
          newState,
          proposedState,
          Direction.Right,
          TILE_SIZE,
          0,
        );
        break;
      case Key.Control:
        newState.action = PlayerAction.Attack;
        handleAttack(newState);
        break;
      case Key.e:
        pickUpItem(getMap(player.mapId)!, player);
        break;
    }

    await delay((DEFAULT_PLAYER_SPEED * BOOST_MULTIPLIER) / player.speed);

    const collision = hasCollision(proposedState);
    const warp = hasWarp(proposedState);

    if (!collision) {
      newState.position = proposedState.position;
      if (warp) {
        newState.mapId = warp.to;
        newState.position = warp.position;
      }
    }

    updatePlayerMap(player.id, newState);

    const updatedPlayer = getPlayerByName(username);
    if (updatedPlayer) {
      const map = getMap(updatedPlayer.mapId);
      if (map) {
        const row = Math.floor(updatedPlayer.position.y / TILE_SIZE);
        const col = Math.floor(updatedPlayer.position.x / TILE_SIZE);
        const tile = map.tiles[row]?.[col];
        if (tile?.shop) {
          const ws = playersWsMap.get(updatedPlayer.name);
          if (ws && ws.readyState === ws.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'openShop',
                shopId: tile.shop,
              }),
            );
          }
        }
      }
    }
  }

  isActing = false;
};

const updatePlayerPositionAndDirection = (
  newState: Player,
  proposedState: Player,
  direction: Direction,
  dx: number,
  dy: number,
) => {
  newState.direction = direction;
  newState.action = PlayerAction.Walk;
  proposedState.position.x += dx;
  proposedState.position.y += dy;
};

export const handleKeyAction = (action: ClientKeyboardAction) => {
  const { username, keyboardAction } = action;
  switch (keyboardAction.type) {
    case 'press':
      handleKeyPress(username, keyboardAction.key);
      break;
    case 'release':
      handleKeyRelease(username, keyboardAction.key);
      break;
    default:
      console.warn(`Unknown item action: ${keyboardAction.key}`);
      break;
  }
};

export const handleKeyRelease = (username: string, key: Key) => {
  const player = getPlayerByName(username);
  if (player) {
    const newState = { ...player };
    if (key === Key.Control) newState.action = PlayerAction.Idle;
    if (key === Key.Shift) newState.speed = DEFAULT_PLAYER_SPEED;
    if (
      [Key.ArrowDown, Key.ArrowLeft, Key.ArrowRight, Key.ArrowUp].includes(key)
    ) {
      newState.action = PlayerAction.Idle;
    }
    updatePlayer(newState);
  }
};

export const mapSave = (mapId: string, tiles: Tile[][]) => {
  const newMap = insertModeCell(mapId, tiles);
  updateMapById(newMap as MapState);
};

export const changeSprite = (spriteId: number, username: string) => {
  const newPlayer: Player = {
    ...getPlayerByName(username)!,
    sprite: spriteId,
  };
  handlePlayerUpdate(newPlayer);
  broadcast();
};

export const getGameState = () => getGameStateDb();

export const getPlayerByName = (username: string) =>
  Object.values(getPlayers()).find((player) => player.name === username);

export const login = (username: string) =>
  getPlayerByName(username) || createPlayer(username);

export const handlePlayerUpdate = (player: Player): void => {
  handlePlayerUpdates(player);
};

export const disconnectPlayer = (username?: string) => {
  const player = username && getPlayerByName(username);
  const map = player && getMap(player.mapId);
  if (!map) return;
  delete map.players[player.id];
  updateMap(map);
};

export const buyShopItem = (
  player: Player,
  itemId: number,
  shop: Shop<ProductRaw>,
): boolean => {
  const item = getItems()[itemId];
  const product = shop.products.find((i) => i.itemId === itemId);
  if (!product) return false;

  const itemInInventory = player.inventory.items.find(
    (i) => i.id === product.currency,
  );
  if (!itemInInventory || itemInInventory.quantity < product.price)
    return false;

  itemInInventory.quantity -= product.price;
  if (itemInInventory.quantity === 0) {
    player.inventory.items = player.inventory.items.filter(
      (i) => i.id !== itemInInventory.id,
    );
  }

  const itemNoInventario = player.inventory.items.find((i) => i.id === item.id);
  if (itemNoInventario) {
    itemNoInventario.quantity += 1;
  } else {
    player.inventory.items.push({ ...item, quantity: 1 });
  }

  return true;
};
