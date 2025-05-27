import React from 'react';
import { Item, Player } from '../../../shared/types';
import { ItemIcon } from './ItemIcon';
import { useStyles } from './styles';
import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';

type Selection = { item: Item; quantity: number };

export const EquipmentPanel: React.FC<{
  selectItem: (sel: Selection) => void;
}> = ({ selectItem }) => {
  const styles = useStyles();
  const player = usePlayerForceUpdate();
  if (!player) return null;

  const slots: { key: keyof Player['equipped']; area: string }[] = [
    { key: 'helmet', area: 'helmet' },
    { key: 'chestplate', area: 'chestplate' },
    { key: 'weapon', area: 'weapon' },
    { key: 'gloves', area: 'gloves' },
    { key: 'boots', area: 'boots' },
  ];

  return (
    <div style={styles.equipPanel}>
      {slots.map(({ key, area }) => {
        const item = player.equipped[key];
        return (
          <div
            key={key}
            style={{ ...styles.slot, ...styles.slotArea(area) }}
            onClick={() => item && selectItem({ item, quantity: 1 })}
            title={item ? item.name : ''}
          >
            {item && <ItemIcon spriteId={item.sprite} />}
          </div>
        );
      })}
    </div>
  );
};
