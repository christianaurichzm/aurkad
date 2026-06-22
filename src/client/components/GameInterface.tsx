import { useLayoutEffect, useRef } from 'react';
import { initializeAssets } from '../io/assets';
import { renderMap } from '../graphics/tileset';
import { handleInput } from '../io/keyboard';
import { initializeWebSocket } from '../io/network';
import { loadClientModules } from '../io/modules/moduleClient';
import { gameLoop } from '../core/game';
import {
  setFullGameState,
  setPlayerStats,
  setStaticMap,
} from '../core/gameState';
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

      setStaticMap({
        id: initialMap.id,
        name: initialMap.name,
        type: initialMap.type,
        tiles: initialMap.tiles,
      });
      setPlayerStats({
        id: player.id,
        name: player.name,
        sprite: player.sprite,
        width: player.width,
        height: player.height,
        maxHealth: player.maxHealth,
        attack: player.attack,
        attackRange: player.attackRange,
        level: player.level,
        experience: player.experience,
        experienceToNextLevel: player.experienceToNextLevel,
        inventory: player.inventory,
        equipped: player.equipped,
        access: player.access,
        strength: player.strength,
        defense: player.defense,
        agility: player.agility,
        vitality: player.vitality,
        unspentPoints: player.unspentPoints,
        speed: player.speed,
        mapId: player.mapId,
        kind: 'player',
      });
      setFullGameState({
        map: {
          id: initialMap.id,
          droppedItems: initialMap.droppedItems,
          npcs: initialMap.npcs,
          players: initialMap.players,
        },
        player: {
          id: player.id,
          position: player.position,
          targetPosition: player.targetPosition,
          moving: player.moving,
          moveTick: player.moveTick,
          moveDurationTicks: player.moveDurationTicks,
          direction: player.direction,
          action: player.action,
          health: player.health,
          lastProcessedSeq: player.lastProcessedSeq,
        },
      });
      useUIStore.getState().setCurrentMap(initialMap);
      handleInput();
      await initializeAssets();
      initializeWebSocket();
      void loadClientModules();
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
          id="currentMapName"
          style={{
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
