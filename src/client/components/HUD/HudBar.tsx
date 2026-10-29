import { useEffect, useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { useGame } from '../../GameContext';
import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';
import { Sprite } from '../common/SpritePreview';
import { getHealthBarInfo } from '../../graphics/hud';
import { useT } from '../../i18n';
import { onServerEvent } from '../../io/network/customEvents';
import { mapAllowsPvp } from '../../../shared/utils';
import { useGameBrand } from '../common/AuthLayout';

// The same three bands the world paints over a hurt NPC, named by the colour
// token each one reads in styles.css so a theme can recolour them.
const healthTone: Record<string, string> = {
  green: 'success',
  yellow: 'warning',
  red: 'danger',
};

export const HudBar = () => {
  const t = useT();
  // The live player's name and sprite when there is one, so a GM change
  // shows here; the session's otherwise.
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const identity = livePlayer ?? sessionPlayer;
  const { current, max, level = 1 } = useUIStore((state) => state.playerHealth);
  const xp = useUIStore((state) => state.playerXp);
  const levels = useGameBrand()?.levels !== false;
  const { percentage, color } = getHealthBarInfo(current, max);
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
    <div id="hud" className="panel">
      <div id="hud-portrait" data-sprite={identity?.sprite ?? 0}>
        <Sprite spriteId={identity?.sprite ?? 0} size={48} />
      </div>
      <div className="hud-stats">
        <div id="hud-who">
          <span id="hud-name">{identity?.name}</span>
          {levels && <span id="hud-level">{t('hud.level', { level })}</span>}
        </div>
        <div id="hud-row" data-tone={healthTone[color]}>
          <span id="hud-hp-label">{t('hud.hp')}</span>
          <div
            id="health-bar-container"
            role="progressbar"
            aria-label={t('hud.hp')}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={current}
          >
            <div id="health-bar" style={{ width: `${percentage * 100}%` }} />
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
            </div>
            <span className="hud-resource-values">
              {Math.floor(mana.current)}/{mana.max}
            </span>
          </div>
        )}
        {levels && (
          <div
            id="xp-bar-container"
            title={`${t('hud.xp')} ${xp.current}/${xp.max}`}
          >
            <span id="hud-xp-label">{t('hud.xp')}</span>
            <div className="xp-track">
              <div id="xp-bar" style={{ width: `${xpPercentage * 100}%` }} />
            </div>
            <span id="xp-bar-text">
              {xp.current}/{xp.max}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

// Primitives, since the store rebuilds currentMap on every state message.
export const MapName = () => {
  const id = useUIStore((state) => state.currentMap?.id);
  const name = useUIStore((state) => state.currentMap?.name);
  const pvp = useUIStore(
    (state) => !!state.currentMap && mapAllowsPvp(state.currentMap),
  );
  if (!name) return null;
  return (
    <>
      <div id="map-name" className={pvp ? 'map-name-pvp' : undefined}>
        {name}
      </div>
      {/* Announced across the world as it is entered, then faded out by the
          stylesheet; keyed by map so the next one plays it again. The pill
          above is what a screen reader, and a player who looked away, reads. */}
      <div className="zone-banner" key={id} aria-hidden="true">
        {name}
      </div>
    </>
  );
};

// The world's edge pulsing red while health is in the red band of the bar.
export const LowHealthVignette = () => {
  const low = useUIStore(({ playerHealth: { current, max } }) => {
    return current > 0 && getHealthBarInfo(current, max).color === 'red';
  });
  return low ? (
    <div className="low-health-vignette" aria-hidden="true" />
  ) : null;
};
