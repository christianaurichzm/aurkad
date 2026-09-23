import { useEffect, useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useGame } from '../../context/GameContext';
import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';
import { SpritePreview } from '../common/SpritePreview';
import { getHealthBarInfo } from '../../graphics/hud';
import { useT } from '../../i18n';
import { onServerEvent } from '../../io/network/customEvents';

export const HudBar = () => {
  const t = useT();
  // The live player's name and sprite when there is one, so a GM change
  // shows here; the session's otherwise.
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const identity = livePlayer ?? sessionPlayer;
  const { current, max, level = 1 } = useUIStore((state) => state.playerHealth);
  const xp = useUIStore((state) => state.playerXp);
  const { percentage, color, text } = getHealthBarInfo(current, max);
  const xpPercentage =
    xp.max > 0 ? Math.max(0, Math.min(xp.current / xp.max, 1)) : 0;

  const [mana, setMana] = useState<{ current: number; max: number } | null>(
    null,
  );

  useEffect(
    () =>
      onServerEvent('magic:update', (payload) => {
        if (!payload || typeof payload !== 'object') return;
        const data = payload as { mana?: unknown; manaMax?: unknown };
        if (
          typeof data.mana !== 'number' ||
          !Number.isFinite(data.mana) ||
          typeof data.manaMax !== 'number' ||
          !Number.isFinite(data.manaMax) ||
          data.manaMax <= 0
        )
          return;
        setMana({
          current: Math.max(0, Math.min(data.mana, data.manaMax)),
          max: data.manaMax,
        });
      }),
    [],
  );

  return (
    <div id="hud">
      <div id="hud-identity">
        <SpritePreview
          spriteId={identity?.sprite ?? 0}
          size={38}
          style={{ background: 'rgba(0,0,0,0.25)' }}
        />
        <div id="hud-who">
          <span id="hud-name">{identity?.name}</span>
          <span id="hud-level">{t('hud.level', { level })}</span>
        </div>
      </div>
      <div id="hud-row">
        <span id="hud-hp-label">{t('hud.hp')}</span>
        <div id="health-bar-container">
          <div
            id="health-bar"
            style={{
              width: `${percentage * 100}%`,
              backgroundColor: color,
            }}
          />
          <div id="health-bar-text">{text}</div>
        </div>
        <span id="hud-hp-values">
          {current}/{max}
        </span>
      </div>
      {mana && (
        <div className="hud-resource-row">
          <span className="hud-resource-label">{t('hud.mp')}</span>
          <div
            className="mana-track"
            role="progressbar"
            aria-label={t('hud.mana')}
            aria-valuemin={0}
            aria-valuemax={mana.max}
            aria-valuenow={mana.current}
          >
            <div
              className="mana-fill"
              style={{ width: `${(mana.current / mana.max) * 100}%` }}
            />
            <div className="mana-text">
              {getHealthBarInfo(mana.current, mana.max).text}
            </div>
          </div>
          <span className="hud-resource-values">
            {Math.floor(mana.current)}/{mana.max}
          </span>
        </div>
      )}
      <div id="xp-bar-container" title={`${xp.current}/${xp.max} XP`}>
        <div id="xp-bar" style={{ width: `${xpPercentage * 100}%` }} />
        <div id="xp-bar-text">
          {t('hud.xp', { current: xp.current, max: xp.max })}
        </div>
      </div>
    </div>
  );
};

// Primitives, since the store rebuilds currentMap on every state message.
export const MapName = () => {
  const name = useUIStore((state) => state.currentMap?.name);
  const pvp = useUIStore((state) => state.currentMap?.type === 'pvp');
  if (!name) return null;
  return (
    <div id="map-name" className={pvp ? 'map-name-pvp' : undefined}>
      {name}
    </div>
  );
};
