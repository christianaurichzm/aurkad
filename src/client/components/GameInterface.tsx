import { useLayoutEffect, useRef } from 'react';
import { initializeAssets } from '../io/files';
import { initTilesetEditor, renderMap } from '../graphics/tileset';
import { handleInput } from '../io/keyboard';
import { initializeWebSocket } from '../io/network';
import { gameLoop } from '../core/game';
import { setFullGameState } from '../core/gameState';
import { useGame } from '../context/GameContext';
import { ConnectionStatus } from './HUD/ConnectionStatus';
import { useUIStore } from '../stores/uiStore';

export const GameInterface = () => {
  const { map: initialMap, player } = useGame();
  const initialized = useRef(false);
  const currentMap = useUIStore((state) => state.currentMap);

  useLayoutEffect(() => {
    if (!initialMap || !player || initialized.current) return;

    const init = async () => {
      initialized.current = true;

      setFullGameState({ map: initialMap, player });
      useUIStore.getState().setCurrentMap(initialMap);
      handleInput();
      await initializeAssets();
      initializeWebSocket();
      await renderMap(initialMap.tiles);
      requestAnimationFrame(gameLoop);
    };

    init();
  }, [initialMap, player]);

  return (
    <>
      <ConnectionStatus />
      <div id="gameInfo">
        <p
          id="mapName"
          style={{
            textAlign: 'center',
            margin: '20px',
            color: currentMap?.type === 'normal' ? 'black' : 'red',
          }}
        >
          {currentMap?.id} - {currentMap?.name || 'Loading Map...'}
        </p>
        <div id="gameArea"></div>
      </div>
    </>
  );
};
