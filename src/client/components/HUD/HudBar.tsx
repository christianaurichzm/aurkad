import { useUIStore } from '../../stores/uiStore';
import { getHealthBarInfo } from '../../graphics/hud';

export const HudBar = () => {
  const { current, max, level = 1 } = useUIStore((state) => state.playerHealth);
  const { percentage, color, text } = getHealthBarInfo(current, max);

  return (
    <div id="hud">
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
  );
};
