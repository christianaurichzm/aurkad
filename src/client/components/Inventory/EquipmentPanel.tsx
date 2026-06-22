import React from 'react';
import { Item, Player } from '../../../shared/types';
import { ItemIcon } from './ItemIcon';
import { useStyles } from './styles';

type Selection = { item: Item; quantity: number };

export const EquipmentPanel: React.FC<{
  player: Player;
  selectItem: (sel: Selection) => void;
  onItemHover: (item: Item, qty: number, x: number, y: number) => void;
  onItemHoverMove: (x: number, y: number) => void;
  onItemHoverLeave: () => void;
}> = ({
  player,
  selectItem,
  onItemHover,
  onItemHoverMove,
  onItemHoverLeave,
}) => {
  const styles = useStyles();

  const slots: {
    key: keyof Player['equipped'];
    area: string;
    label: string;
  }[] = [
    { key: 'helmet', area: 'helmet', label: 'Helmet' },
    { key: 'chestplate', area: 'chestplate', label: 'Chest' },
    { key: 'weapon', area: 'weapon', label: 'Weapon' },
    { key: 'gloves', area: 'gloves', label: 'Gloves' },
    { key: 'boots', area: 'boots', label: 'Boots' },
  ];

  return (
    <div style={styles.equipmentContent}>
      <div style={styles.equipPanel}>
        {slots.map(({ key, area, label }) => {
          const item = player.equipped[key];
          return (
            <div
              key={key}
              style={{ ...styles.slotWrap, ...styles.slotArea(area) }}
            >
              <div
                style={styles.slot}
                onClick={() => item && selectItem({ item, quantity: 1 })}
                onMouseEnter={(e) =>
                  item && onItemHover(item, 1, e.clientX, e.clientY)
                }
                onMouseMove={(e) =>
                  item && onItemHoverMove(e.clientX, e.clientY)
                }
                onMouseLeave={onItemHoverLeave}
                title={item ? item.name : label}
              >
                {item && <ItemIcon spriteId={item.sprite} />}
              </div>
              <span style={styles.slotLabel}>{item?.name || label}</span>
            </div>
          );
        })}
      </div>
      <div style={styles.equipmentStats}>
        <div style={styles.statLine}>
          <span>Level</span>
          <strong>{player.level}</strong>
        </div>
        <div style={styles.statLine}>
          <span>Attack</span>
          <strong>{player.attack}</strong>
        </div>
        <div style={styles.statLine}>
          <span>Strength</span>
          <strong>{player.strength}</strong>
        </div>
        <div style={styles.statLine}>
          <span>Defense</span>
          <strong>{player.defense}</strong>
        </div>
        <div style={styles.statLine}>
          <span>Agility</span>
          <strong>{player.agility}</strong>
        </div>
        <div style={styles.statLine}>
          <span>Vitality</span>
          <strong>{player.vitality}</strong>
        </div>
        <div style={styles.statLine}>
          <span>Health</span>
          <strong>
            {player.health}/{player.maxHealth}
          </strong>
        </div>
        <div style={styles.statLine}>
          <span>Speed</span>
          <strong>{player.speed}</strong>
        </div>
      </div>
    </div>
  );
};
