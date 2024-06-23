import { gameLoop } from './core/game';
import { updateGameState } from './core/gameState';
import { handleInput } from './io/keyboard';
import { initializeWebSocket, login } from './io/network';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginContainer = document.getElementById('loginContainer');
  const gameContainer = document.getElementById('gameContainer');
  const errorMessage = document.getElementById('errorMessage');

  if (loginForm && loginContainer && gameContainer && errorMessage) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await handleLogin(loginContainer, gameContainer, errorMessage);
    });
  }
});

async function handleLogin(
  loginContainer: HTMLElement,
  gameContainer: HTMLElement,
  errorMessage: HTMLElement,
) {
  const usernameInput = document.getElementById('username') as HTMLInputElement;

  if (usernameInput) {
    const username = usernameInput.value;

    try {
      const data = await login(username);
      validateResponse(data);

      const { playerId, map } = data;

      if (playerId) {
        updateGameState(map, playerId);
        toggleContainers(loginContainer, gameContainer);
        handleInput();
        initializeGame();
        initializeWebSocket(playerId);
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
) {
  loginContainer.style.display = 'none';
  gameContainer.style.display = 'block';
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
