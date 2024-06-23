import { gameLoop } from './core/game';
import { updateGameState } from './core/gameState';
import { getPlayer, setPlayer } from './core/player';
import { handleInput } from './io/keyboard';

document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('loginForm');
  const loginContainer = document.getElementById('loginContainer');
  const gameContainer = document.getElementById('gameContainer');
  const errorMessage = document.getElementById('errorMessage');

  if (loginForm && loginContainer && gameContainer && errorMessage) {
    loginForm.addEventListener('submit', async function (event) {
      event.preventDefault();

      const usernameInput = document.getElementById(
        'username',
      ) as HTMLInputElement;

      if (usernameInput) {
        const username = usernameInput.value;

        try {
          const response = await fetch(`http://localhost:8080/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username }),
          });

          if (!response.ok) {
            throw new Error('Login failed');
          }

          const data = await response.json();

          if (!data) {
            throw new Error('Invalid response from server');
          }

          const { playerId, map } = data;

          if (map && playerId) {
            updateGameState(map, playerId);
            loginContainer.style.display = 'none';
            gameContainer.style.display = 'block';
            initializeGame();
          } else {
            throw new Error('Invalid map or player ID');
          }
        } catch (error) {
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
      }
    });
  }
});

function initializeGame() {
  const player = getPlayer();
  if (player) {
    handleInput();
    requestAnimationFrame(gameLoop);
  } else {
    console.error('Player not found');
  }
}
