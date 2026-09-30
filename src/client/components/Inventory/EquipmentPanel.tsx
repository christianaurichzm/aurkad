import React from 'react';
import { EQUIPMENT_SLOTS } from '../../../shared/constants';
import type { EquipmentSlot, Player } from '../../../shared/types';
import { SpritePreview } from '../common/SpritePreview';
import { ItemSlot } from './ItemIcon';
import { useT, type TranslationKey } from '../../i18n';

const SLOT_LABELS: Record<EquipmentSlot, TranslationKey> = {
  weapon: 'item.typeWeapon',
  helmet: 'item.typeHelmet',
  chestplate: 'item.typeChestplate',
  gloves: 'item.typeGloves',
  boots: 'item.typeBoots',
};

// SpritePreview frames itself inline; here the character stands bare between
// the slots.
const bare = {
  display: 'block',
  border: 'none',
  borderRadius: 0,
  background: 'none',
};

export const EquipmentPanel: React.FC<{
  player: Player;
  selected: number | null;
  onSelect: (itemId: number) => void;
}> = ({ player, selected, onSelect }) => {
  const t = useT();

  return (
    <>
      <div className="equip-doll">
        <span className="equip-body" aria-hidden="true">
          <SpritePreview spriteId={player.sprite} size={96} style={bare} />
        </span>
        {EQUIPMENT_SLOTS.map((slot) => {
          const item = player.equipped[slot];
          const label = t(SLOT_LABELS[slot]);
          return (
            <div key={slot} className="equip-slot" style={{ gridArea: slot }}>
              {item ? (
                <ItemSlot
                  item={item}
                  selected={selected === item.id}
                  note={label}
                  onSelect={() => onSelect(item.id)}
                />
              ) : (
                <span
                  className="item-slot"
                  data-empty
                  role="img"
                  aria-label={t('inventory.slotEmpty', { slot: label })}
                />
              )}
              <span className="equip-label">{label}</span>
            </div>
          );
        })}
      </div>
      <dl className="equip-totals">
        <div>
          <dt>{t('stats.attack')}</dt>
          <dd>{player.attack}</dd>
        </div>
        <div>
          <dt>{t('stats.defense')}</dt>
          <dd>{player.defense}</dd>
        </div>
        <div>
          <dt>{t('stats.speed')}</dt>
          <dd>{player.speed}</dd>
        </div>
      </dl>
    </>
  );
};
