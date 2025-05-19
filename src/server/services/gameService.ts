import {
  BOOST_MULTIPLIER,
  TILE_SIZE,
  DEFAULT_PLAYER_SPEED,
} from '../../shared/constants';
import {
  Key,
  Direction,
  PlayerAction,
  PlayerServer,
  ClientKeyboardAction,
  Tile,
  MapStateServer,
  Shop,
  ProductRaw,
} from '../../shared/types';
import {
  getMap,
  updatePlayer,
  updateMapById,
  getRuntimeState,
  getPlayers,
  updateMap,
} from '../gameData';
import { playersWsMap, broadcast } from '../wsServer';
import { handleAttack } from './combatService';
import { pickUpItem } from './inventoryService';
import { insertModeCell, updatePlayerMap } from './mapService';
import { hasCollision, hasWarp } from './physicsService';
import { createPlayer, handlePlayerUpdates } from './playerService';
import { getItemById } from './inventoryService';

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
        await pickUpItem(getMap(player.mapId)!, player);
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
  newState: PlayerServer,
  proposedState: PlayerServer,
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

export const mapSave = async (mapId: string, tiles: Tile[][]) => {
  const newMap = await insertModeCell(mapId, tiles);

  await updateMapById(newMap as MapStateServer);
};

export const changeSprite = (spriteId: number, username: string) => {
  const newPlayer: PlayerServer = {
    ...getPlayerByName(username)!,
    sprite: spriteId,
  };
  handlePlayerUpdate(newPlayer);
  broadcast();
};

export const getGameState = () => getRuntimeState();

export const getPlayerByName = (username: string) =>
  Object.values(getPlayers()).find((player) => player.name === username);

export const login = (username: string) =>
  getPlayerByName(username) || createPlayer(username);

export const handlePlayerUpdate = (player: PlayerServer): void => {
  handlePlayerUpdates(player);
};

export const disconnectPlayer = (username?: string) => {
  const player = username && getPlayerByName(username);
  const map = player && getMap(player.mapId);
  if (!map) return;
  delete map.players[player.id];
  updateMap(map);
};

export const buyShopItem = async (
  player: PlayerServer,
  itemId: number,
  shop: Shop<ProductRaw>,
): Promise<boolean> => {
  const product = shop.products.find((p) => p.itemId === itemId);
  if (!product) return false;

  const currencyInInventory = player.inventory.items.find(
    (i) => i.item === product.currency,
  );
  if (!currencyInInventory || currencyInInventory.quantity < product.price)
    return false;

  currencyInInventory.quantity -= product.price;
  if (currencyInInventory.quantity === 0) {
    player.inventory.items = player.inventory.items.filter(
      (i) => i.item !== product.currency,
    );
  }

  const existingItem = player.inventory.items.find((i) => i.item === itemId);
  if (existingItem) {
    existingItem.quantity++;
  } else {
    player.inventory.items.push({ item: itemId, quantity: 1 });
  }

  await updatePlayer(player);
  return true;
};
