import React from 'react';
import { Item, Player } from '../../../shared/types';
import { ItemIcon } from './ItemIcon';
import { useStyles } from './styles';
import { useT } from '../../i18n';

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
  const t = useT();
  const styles = useStyles();

  const slots: {
    key: keyof Player['equipped'];
    area: string;
    label: string;
  }[] = [
    { key: 'helmet', area: 'helmet', label: t('item.typeHelmet') },
    { key: 'chestplate', area: 'chestplate', label: t('item.typeChestplate') },
    { key: 'weapon', area: 'weapon', label: t('item.typeWeapon') },
    { key: 'gloves', area: 'gloves', label: t('item.typeGloves') },
    { key: 'boots', area: 'boots', label: t('item.typeBoots') },
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
          <span>{t('stats.level')}</span>
          <strong>{player.level}</strong>
        </div>
        <div style={styles.statLine}>
          <span>{t('stats.attack')}</span>
          <strong>{player.attack}</strong>
        </div>
        <div style={styles.statLine}>
          <span>{t('stats.strength')}</span>
          <strong>{player.strength}</strong>
        </div>
        <div style={styles.statLine}>
          <span>{t('stats.defense')}</span>
          <strong>{player.defense}</strong>
        </div>
        <div style={styles.statLine}>
          <span>{t('stats.agility')}</span>
          <strong>{player.agility}</strong>
        </div>
        <div style={styles.statLine}>
          <span>{t('stats.vitality')}</span>
          <strong>{player.vitality}</strong>
        </div>
        <div style={styles.statLine}>
          <span>{t('stats.health')}</span>
          <strong>
            {player.health}/{player.maxHealth}
          </strong>
        </div>
        <div style={styles.statLine}>
          <span>{t('stats.speed')}</span>
          <strong>{player.speed}</strong>
        </div>
      </div>
    </div>
  );
};
