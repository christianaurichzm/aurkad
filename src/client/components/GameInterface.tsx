import { useLayoutEffect, useRef } from 'react';
import { initializeAssets } from '../io/files';
import { initTilesetEditor, renderMap } from '../graphics/tileset';
import { handleInput } from '../io/keyboard';
import { initializeWebSocket } from '../io/network';
import { gameLoop } from '../core/game';
import { setFullGameState } from '../core/gameState';
import { useGame } from '../context/GameContext';

export const GameInterface = () => {
  const { map, player } = useGame();
  const initialized = useRef(false);

  useLayoutEffect(() => {
    if (!map || !player || initialized.current) return;

    const init = async () => {
      initialized.current = true;

      setFullGameState({ map, player });
      handleInput();
      initializeWebSocket();
      await initializeAssets();
      await renderMap(map.tiles);
      requestAnimationFrame(gameLoop);
    };

    init();
  }, [map, player]);

  return (
    <div id="gameInfo">
      <p
        id="mapName"
        style={{
          textAlign: 'center',
          margin: '20px',
          color: map?.type === 'normal' ? 'black' : 'red',
        }}
      >
        {map?.id} - {map?.name || 'Loading Map...'}
      </p>
      <div id="connection-status">Connecting...</div>
      <div id="gameArea"></div>
    </div>
  );
};
