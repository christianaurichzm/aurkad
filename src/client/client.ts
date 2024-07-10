import { gameLoop } from './core/game';
import { updateGameState } from './core/gameState';
import { renderMap } from './graphics/tileset';
import { initializeAssets } from './io/files';
import { handleInput } from './io/keyboard';
import { initializeWebSocket, login } from './io/network';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginContainer = document.getElementById('loginContainer');
  const gameContainer = document.getElementById('gameContainer');
  const hudContainer = document.getElementById('hud');
  const errorMessage = document.getElementById('errorMessage');

  if (
    loginForm &&
    loginContainer &&
    gameContainer &&
    hudContainer &&
    errorMessage
  ) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await handleLogin(
        loginContainer,
        gameContainer,
        hudContainer,
        errorMessage,
      );
    });
  }
});

async function handleLogin(
  loginContainer: HTMLElement,
  gameContainer: HTMLElement,
  hudContainer: HTMLElement,
  errorMessage: HTMLElement,
) {
  const usernameInput = document.getElementById('username') as HTMLInputElement;

  if (usernameInput) {
    const username = usernameInput.value;

    try {
      const data = await login(username);
      validateResponse(data);

      if (data?.playerId) {
        const { map } = data;
        updateGameState(map);
        toggleContainers(loginContainer, gameContainer, hudContainer);
        handleInput();
        initializeWebSocket();
        initializeAssets()
          .then(() => {
            renderMap(map.tiles);
            initializeGame();
          })
          .catch((error) => {
            console.error('Error during initialization:', error);
          });
      }
    } catch (error) {
      handleError(error, errorMessage);
    }
  }
}

function validateResponse(data: any) {
  if (!data || !data.map || !data.playerId) {
    throw new Error('Invalid response from server');
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

function handleError(error: unknown, errorMessage: HTMLElement) {
  if (error instanceof Error) {
    errorMessage.style.display = 'block';
    errorMessage.textContent = error.message;
    console.error('Login error:', error);
  } else {
    errorMessage.style.display = 'block';
    errorMessage.textContent = 'An unknown error occurred';
    console.error('Unknown error:', error);
  }
}

const initializeGame = () => requestAnimationFrame(gameLoop);
