import { useUIStore } from '../stores/uiStore';
import { getHealthBarInfo } from '../graphics/hud';

export const HudBar = () => {
  const { current, max } = useUIStore((state) => state.playerHealth);
  const { percentage, color, text } = getHealthBarInfo(current, max);

  return (
    <div id="hud">
      HP:
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
    </div>
  );
};
