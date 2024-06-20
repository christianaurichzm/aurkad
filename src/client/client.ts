import { gameLoop } from './core/game';
import { handleInput } from './io/keyboard';

handleInput();

requestAnimationFrame(gameLoop);