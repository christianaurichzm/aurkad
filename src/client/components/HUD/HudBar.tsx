import { useUIStore } from '../../stores/uiStore';
import { getHealthBarInfo } from '../../graphics/hud';

export const HudBar = () => {
  const { current, max, level = 1 } = useUIStore((state) => state.playerHealth);
  const xp = useUIStore((state) => state.playerXp);
  const { percentage, color, text } = getHealthBarInfo(current, max);
  const xpPercentage =
    xp.max > 0 ? Math.max(0, Math.min(xp.current / xp.max, 1)) : 0;

  return (
    <div id="hud">
      <div id="hud-row">
        <span id="hud-level">Level {level}</span>
        <span id="hud-hp-label">HP</span>
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
          XP {xp.current}/{xp.max}
        </div>
      </div>
    </div>
  );
};
