import { useLayoutEffect, useRef } from 'react';
import { initializeAssets } from '../io/assets';
import { handleInput } from '../io/keyboard';
import { initializeWebSocket } from '../io/network';
import { loadClientModules } from '../io/modules/moduleClient';
import { gameLoop } from '../core/game';
import { initDebugOverlay } from '../graphics/debugOverlay';
import {
  setFullGameState,
  setMapMeta,
  setPlayerStats,
} from '../core/gameState';
import { useGame } from '../context/GameContext';
import { ConnectionStatus } from './HUD/ConnectionStatus';
import { useUIStore } from '../stores/uiStore';

export const GameInterface = () => {
  const { map: initialMap, player } = useGame();
  const initialized = useRef(false);

  useLayoutEffect(() => {
    if (!initialMap || !player || initialized.current) return;

    const init = async () => {
      initialized.current = true;

      setMapMeta(initialMap);
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
        inventoryCapacity: player.inventoryCapacity,
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
          droppedItems: [],
          npcs: {},
          players: {},
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
      initDebugOverlay();
      // A missing sprite sheet must not keep the socket from opening; only the
      // drawing is lost, and the frame loop reports it. Modules load alongside
      // and finish before the world draws.
      await Promise.all([
        initializeAssets().catch((err: unknown) =>
          console.error('[assets] not loaded; the world will not draw', err),
        ),
        loadClientModules(),
      ]);
      initializeWebSocket();
      requestAnimationFrame(gameLoop);
    };

    void init();
  }, [initialMap, player]);

  return <ConnectionStatus />;
};
