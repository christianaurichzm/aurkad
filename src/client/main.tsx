import ReactDOM from 'react-dom/client';
import App from './pages/App';
import { GameProvider } from './context/GameContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <GameProvider>
    <App />
  </GameProvider>,
);
