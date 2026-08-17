import { useEffect, useState } from 'react';
import { useUIStore } from '../../stores/uiStore';
import { getHealthBarInfo } from '../../graphics/hud';
import { PLAYER_ATTACK_COOLDOWN_MS } from '../../../shared/constants';
import { useT } from '../../i18n';

export const HudBar = () => {
  const t = useT();
  const { current, max, level = 1 } = useUIStore((state) => state.playerHealth);
  const xp = useUIStore((state) => state.playerXp);
  const attackCooldownUntil = useUIStore((s) => s.attackCooldownUntil);
  const { percentage, color, text } = getHealthBarInfo(current, max);
  const xpPercentage =
    xp.max > 0 ? Math.max(0, Math.min(xp.current / xp.max, 1)) : 0;

  const [cooldownFraction, setCooldownFraction] = useState(0);

  useEffect(() => {
    let rafId: number;
    const update = () => {
      const remaining = attackCooldownUntil - Date.now();
      if (remaining <= 0) {
        setCooldownFraction(0);
        return;
      }
      setCooldownFraction(remaining / PLAYER_ATTACK_COOLDOWN_MS);
      rafId = requestAnimationFrame(update);
    };
    rafId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafId);
  }, [attackCooldownUntil]);

  return (
    <div id="hud">
      <div id="hud-row">
        <span id="hud-level">{t('hud.level', { level })}</span>
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
      <div id="xp-bar-container" title={`${xp.current}/${xp.max} XP`}>
        <div id="xp-bar" style={{ width: `${xpPercentage * 100}%` }} />
        <div id="xp-bar-text">
          {t('hud.xp', { current: xp.current, max: xp.max })}
        </div>
      </div>
      {cooldownFraction > 0 && (
        <div id="atk-cooldown-container" title={t('hud.attackCooldown')}>
          <div
            id="atk-cooldown-bar"
            style={{ width: `${cooldownFraction * 100}%` }}
          />
          <div id="atk-cooldown-label">{t('hud.atk')}</div>
        </div>
      )}
    </div>
  );
};
