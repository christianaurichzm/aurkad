import {
  getEl,
  getInputValue,
  setVisibility,
  show,
  hide,
  setText,
  addEvent,
} from '../server/domHelpers';
import { MapState, Player } from '../shared/types';
import { gameLoop } from './core/game';
import { setPlayer, updateGameState } from './core/gameState';
import { renderMap } from './graphics/tileset';
import { initializeAssets } from './io/files';
import { handleInput } from './io/keyboard';
import { initializeWebSocket, login } from './io/network';

const ELEMENT_IDS = {
  LOGIN_FORM: 'loginForm',
  LOGIN_CONTAINER: 'loginContainer',
  CANVAS_CONTAINER: 'canvasContainer',
  HUD_CONTAINER: 'hud',
  ERROR_MESSAGE: 'errorMessage',
  USERNAME_INPUT: 'username',
  GAME_INFO: 'gameInfo',
  MAP_NAME: 'mapName',
  CHAT_CONTAINER: 'chatContainer',
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  const loginForm = getEl<HTMLFormElement>(ELEMENT_IDS.LOGIN_FORM);
  const loginContainer = getEl(ELEMENT_IDS.LOGIN_CONTAINER);
  const canvasContainer = getEl(ELEMENT_IDS.CANVAS_CONTAINER);
  const hudContainer = getEl(ELEMENT_IDS.HUD_CONTAINER);
  const errorMessage = getEl(ELEMENT_IDS.ERROR_MESSAGE);

  if (
    loginForm &&
    loginContainer &&
    canvasContainer &&
    hudContainer &&
    errorMessage
  ) {
    addEvent<HTMLFormElement>(ELEMENT_IDS.LOGIN_FORM, 'submit', (event) =>
      handleLogin(event),
    );
  }
}

async function handleLogin(event: Event) {
  event.preventDefault();
  const username = getInputValue(ELEMENT_IDS.USERNAME_INPUT);

  if (username) {
    try {
      const data = await login(username);
      await processLoginSuccess(data as { map: MapState; player: Player });
    } catch (error) {
      displayError(error, ELEMENT_IDS.ERROR_MESSAGE);
    }
  }
}

async function processLoginSuccess(data: { map: MapState; player: Player }) {
  const { map, player } = data;
  updateGameState(map);
  setPlayer(player);
  toggleContainers(map);
  handleInput();
  initializeWebSocket();

  show(ELEMENT_IDS.CHAT_CONTAINER, 'flex');

  try {
    await initializeAssets();
    await renderMap(map.tiles);
    startGameLoop();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

function toggleContainers(map: MapState) {
  hide(ELEMENT_IDS.LOGIN_CONTAINER);
  show(ELEMENT_IDS.CANVAS_CONTAINER, 'block');
  show(ELEMENT_IDS.HUD_CONTAINER, 'flex');

  const gameInfo = getEl(ELEMENT_IDS.GAME_INFO);
  const mapName = getEl(ELEMENT_IDS.MAP_NAME);

  if (gameInfo) show(ELEMENT_IDS.GAME_INFO, 'flex');
  if (mapName) {
    setText(ELEMENT_IDS.MAP_NAME, `${map.id} - ${map.name}`);
    mapName.style.color = map.type === 'pvp' ? 'red' : '';
  }
}

function displayError(error: unknown, errorId: string) {
  setVisibility(errorId, true, 'block');
  if (typeof error === 'string') {
    setText(errorId, error);
  } else if (error instanceof Error) {
    setText(errorId, error.message);
  } else if (error && typeof error === 'object' && 'message' in error) {
    setText(errorId, (error as any).message);
  } else {
    setText(errorId, 'An unknown error occurred');
  }
  console.error('Login error:', error);
}

function startGameLoop() {
  requestAnimationFrame(gameLoop);
}
