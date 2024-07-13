import { gameLoop } from './core/game';
import { updateGameState } from './core/gameState';
import { renderMap } from './graphics/tileset';
import { initializeAssets } from './io/files';
import { handleInput } from './io/keyboard';
import { initializeWebSocket, login } from './io/network';

document.addEventListener('DOMContentLoaded', init);

const ELEMENT_IDS = {
  LOGIN_FORM: 'loginForm',
  LOGIN_CONTAINER: 'loginContainer',
  GAME_CONTAINER: 'gameContainer',
  HUD_CONTAINER: 'hud',
  ERROR_MESSAGE: 'errorMessage',
  USERNAME_INPUT: 'username',
};

function init() {
  const loginForm = document.getElementById(ELEMENT_IDS.LOGIN_FORM);
  const loginContainer = document.getElementById(ELEMENT_IDS.LOGIN_CONTAINER);
  const gameContainer = document.getElementById(ELEMENT_IDS.GAME_CONTAINER);
  const hudContainer = document.getElementById(ELEMENT_IDS.HUD_CONTAINER);
  const errorMessage = document.getElementById(ELEMENT_IDS.ERROR_MESSAGE);

  if (
    loginForm &&
    loginContainer &&
    gameContainer &&
    hudContainer &&
    errorMessage
  ) {
    loginForm.addEventListener('submit', (event) =>
      handleLogin(
        event,
        loginContainer,
        gameContainer,
        hudContainer,
        errorMessage,
      ),
    );
  }
}

async function handleLogin(
  event: Event,
  loginContainer: HTMLElement,
  gameContainer: HTMLElement,
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
      const data = await login(username);
      validateResponse(data);
      await processLoginSuccess(
        data,
        loginContainer,
        gameContainer,
        hudContainer,
      );
    } catch (error) {
      displayError(error, errorMessage);
    }
  }
}

function validateResponse(data: any) {
  if (!data || !data.map || !data.playerId) {
    throw new Error('Invalid response from server');
  }
}

async function processLoginSuccess(
  data: any,
  loginContainer: HTMLElement,
  gameContainer: HTMLElement,
  hudContainer: HTMLElement,
) {
  const { map } = data;
  updateGameState(map);
  toggleContainers(loginContainer, gameContainer, hudContainer);
  handleInput();
  initializeWebSocket();
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
  gameContainer: HTMLElement,
  hudContainer: HTMLElement,
) {
  loginContainer.style.display = 'none';
  gameContainer.style.display = 'block';
  hudContainer.style.display = 'flex';
  hudContainer.style.flexDirection = 'row';
  hudContainer.style.alignItems = 'center';
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
