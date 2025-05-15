import { MapState, Player } from '../shared/types';
import { gameLoop } from './core/game';
import { setPlayer, updateGameState } from './core/gameState';
import { renderMap } from './graphics/tileset';
import { initializeAssets } from './io/files';
import { handleInput } from './io/keyboard';
import { initializeWebSocket, login } from './io/network';

document.addEventListener('DOMContentLoaded', init);

const ELEMENT_IDS = {
  LOGIN_FORM: 'loginForm',
  LOGIN_CONTAINER: 'loginContainer',
  CANVAS_CONTAINER: 'canvasContainer',
  HUD_CONTAINER: 'hud',
  ERROR_MESSAGE: 'errorMessage',
  USERNAME_INPUT: 'username',
  GAME_INFO: 'gameInfo',
  MAP_NAME: 'mapName',
};

function init() {
  const loginForm = document.getElementById(ELEMENT_IDS.LOGIN_FORM);
  const loginContainer = document.getElementById(ELEMENT_IDS.LOGIN_CONTAINER);
  const canvasContainer = document.getElementById(ELEMENT_IDS.CANVAS_CONTAINER);
  const hudContainer = document.getElementById(ELEMENT_IDS.HUD_CONTAINER);
  const errorMessage = document.getElementById(ELEMENT_IDS.ERROR_MESSAGE);

  if (
    loginForm &&
    loginContainer &&
    canvasContainer &&
    hudContainer &&
    errorMessage
  ) {
    loginForm.addEventListener('submit', (event) =>
      handleLogin(
        event,
        loginContainer,
        canvasContainer,
        hudContainer,
        errorMessage,
      ),
    );
  }
}

async function handleLogin(
  event: Event,
  loginContainer: HTMLElement,
  canvasContainer: HTMLElement,
  hudContainer: HTMLElement,
  errorMessage: HTMLElement,
) {
  event.preventDefault();
  const usernameInput = document.getElementById(
    ELEMENT_IDS.USERNAME_INPUT,
  ) as HTMLInputElement;

  if (usernameInput) {
    const username = usernameInput.value;
    try {
      const data: { map: MapState; player: Player } | null =
        await login(username);
      validateResponse(data);
      await processLoginSuccess(
        data!,
        loginContainer,
        canvasContainer,
        hudContainer,
      );
    } catch (error) {
      displayError(error, errorMessage);
    }
  }
}

function validateResponse(data: { map: MapState; player: Player } | null) {
  if (!data || !data.map || !data.player) {
    throw new Error('Invalid response from server');
  }
}

async function processLoginSuccess(
  data: { map: MapState; player: Player },
  loginContainer: HTMLElement,
  canvasContainer: HTMLElement,
  hudContainer: HTMLElement,
) {
  const { map, player } = data;
  updateGameState(map);
  setPlayer(player);
  toggleContainers(loginContainer, canvasContainer, hudContainer, map);
  handleInput();
  initializeWebSocket();

  const chatContainer = document.getElementById('chatContainer');
  if (chatContainer) {
    chatContainer.style.display = 'flex';
  }

  try {
    await initializeAssets();
    await renderMap(map.tiles);
    startGameLoop();
  } catch (error) {
    console.error('Error during initialization:', error);
  }
}

function toggleContainers(
  loginContainer: HTMLElement,
  canvasContainer: HTMLElement,
  hudContainer: HTMLElement,
  map: MapState,
) {
  const gameInfo = document.getElementById(
    ELEMENT_IDS.GAME_INFO,
  ) as HTMLElement;
  const mapName = document.getElementById(ELEMENT_IDS.MAP_NAME) as HTMLElement;

  loginContainer.style.display = 'none';
  canvasContainer.style.display = 'block';
  hudContainer.style.display = 'flex';
  hudContainer.style.flexDirection = 'row';
  hudContainer.style.alignItems = 'center';
  gameInfo.style.display = 'flex';
  mapName.textContent = `${map.id} - ${map.name}`;

  if (map.type === 'pvp') {
    mapName.style.color = 'red';
  }
}

function displayError(error: unknown, errorMessage: HTMLElement) {
  errorMessage.style.display = 'block';
  if (error instanceof Error) {
    errorMessage.textContent = error.message;
    console.error('Login error:', error);
  } else {
    errorMessage.textContent = 'An unknown error occurred';
    console.error('Unknown error:', error);
  }
}

function startGameLoop() {
  requestAnimationFrame(gameLoop);
}
