import React, { useEffect, useRef, useState } from 'react';
import { EQUIPMENT_SLOTS, ITEM_SIZE } from '../../../shared/constants';
import type {
  EquipmentSlot,
  Item,
  ItemType,
  ModifiablePlayerAttribute,
  Player,
} from '../../../shared/types';
import { renderItemIcon } from '../../graphics/render';
import { useT, type TranslationKey } from '../../i18n';

interface ItemIconProps {
  spriteId: number;
  /** The side in pixels, for a row that has no room for the 64 the art is. */
  size?: number;
  style?: React.CSSProperties;
}

export const ItemIcon: React.FC<ItemIconProps> = ({
  spriteId,
  size,
  style,
}) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, ITEM_SIZE, ITEM_SIZE);
    renderItemIcon(ctx, spriteId, 0, 0, false);
  }, [spriteId]);

  return (
    <canvas
      ref={ref}
      width={ITEM_SIZE}
      height={ITEM_SIZE}
      style={style ?? { display: 'block', width: size, height: size }}
    />
  );
};

type T = ReturnType<typeof useT>;

const TYPES: Record<ItemType, TranslationKey> = {
  weapon: 'item.typeWeapon',
  helmet: 'item.typeHelmet',
  chestplate: 'item.typeChestplate',
  gloves: 'item.typeGloves',
  boots: 'item.typeBoots',
  consumable: 'item.typeConsumable',
  money: 'item.typeMoney',
};

const STATS: Record<ModifiablePlayerAttribute, TranslationKey> = {
  health: 'stats.health',
  maxHealth: 'stats.maxHealth',
  attack: 'stats.attack',
  strength: 'stats.strength',
  defense: 'stats.defense',
  agility: 'stats.agility',
  vitality: 'stats.vitality',
  speed: 'stats.speed',
  attackRange: 'stats.reach',
  experience: 'stats.experience',
  experienceToNextLevel: 'stats.experience',
  level: 'stats.level',
};

export const itemType = (t: T, item: Pick<Item, 'type'>) => t(TYPES[item.type]);

export const statName = (t: T, stat: ModifiablePlayerAttribute) =>
  t(STATS[stat]);

/** "+5" and "−2": a change with its sign, the minus as wide as the plus. */
export const signed = (value: number) =>
  `${value < 0 ? '−' : '+'}${Math.abs(value)}`;

/** What an item does to whoever uses or wears it: "+5 Attack, ×1.5 Speed". */
export const itemEffects = (t: T, item: Pick<Item, 'effects'>) =>
  (item.effects ?? [])
    .map(
      ({ attribute, type, value }) =>
        `${type === 'multiply' ? `×${value}` : signed(value)} ${statName(t, attribute)}`,
    )
    .join(', ');

const isSlot = (type: Item['type']): type is EquipmentSlot =>
  (EQUIPMENT_SLOTS as readonly string[]).includes(type);

/** What the player wears where `item` would go, when it is worn at all. */
export const wornInPlaceOf = (
  player: Pick<Player, 'equipped'>,
  item: Pick<Item, 'type'>,
) => (isSlot(item.type) ? player.equipped[item.type] : undefined);

// What an item adds and what it multiplies, stat by stat, compared each
// against its own kind: a difference for additions, a ratio for multipliers.
const totals = (item: Pick<Item, 'effects'>) => {
  const byStat = new Map<
    string,
    { stat: ModifiablePlayerAttribute; value: number }
  >();
  for (const { attribute, type, value } of item.effects ?? []) {
    const key = `${type}:${attribute}`;
    const was = byStat.get(key)?.value ?? (type === 'multiply' ? 1 : 0);
    byStat.set(key, {
      stat: attribute,
      value: type === 'multiply' ? was * value : was + value,
    });
  }
  return byStat;
};

/** What wearing `item` would change against `inPlace`, the one it replaces. */
export const ItemComparison = ({
  item,
  inPlace,
}: {
  item: Pick<Item, 'effects'>;
  inPlace: Pick<Item, 'name' | 'effects'>;
}) => {
  const t = useT();
  const mine = totals(item);
  const theirs = totals(inPlace);
  const changes = [...new Set([...mine.keys(), ...theirs.keys()])]
    .map((key) => {
      const stat = (mine.get(key) ?? theirs.get(key))!.stat;
      if (key.startsWith('multiply:')) {
        const ratio =
          (mine.get(key)?.value ?? 1) / (theirs.get(key)?.value ?? 1);
        const shown = Math.round(ratio * 100) / 100;
        return {
          key,
          stat,
          up: ratio > 1,
          change: shown === 1 ? '' : `×${shown}`,
        };
      }
      const change =
        (mine.get(key)?.value ?? 0) - (theirs.get(key)?.value ?? 0);
      return {
        key,
        stat,
        up: change > 0,
        change: change === 0 ? '' : signed(change),
      };
    })
    .filter(({ change }) => change !== '');

  if (changes.length === 0)
    return (
      <p className="item-compare">
        {t('inventory.same', { item: inPlace.name })}
      </p>
    );
  return changes.map(({ key, stat, up, change }) => (
    <p key={key} className="item-compare" data-change={up ? 'up' : 'down'}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span>{' '}
      {t('inventory.versus', {
        change: `${change} ${statName(t, stat)}`,
        item: inPlace.name,
      })}
    </p>
  ));
};

const TOOLTIP_HALF = 118;

/**
 * An item in a box the player can pick: in the bag, worn, on offer. What it
 * is shows over it on hover and on focus, without having to pick it.
 */
export const ItemSlot = ({
  item,
  quantity = 1,
  selected,
  note,
  onSelect,
}: {
  item: Pick<Item, 'name' | 'sprite' | 'type' | 'effects'>;
  quantity?: number;
  selected: boolean;
  /** Said after the name: where it is worn, that it is on offer. */
  note?: string;
  onSelect: () => void;
}) => {
  const t = useT();
  // The box on the screen, not in the window: the window clips what it holds,
  // and the tooltip has to reach past its edge.
  const [box, setBox] = useState<DOMRect | null>(null);
  const show = (e: { currentTarget: HTMLElement }) =>
    setBox(e.currentTarget.getBoundingClientRect());
  const hide = () => setBox(null);
  const effects = itemEffects(t, item);

  return (
    <>
      <button
        type="button"
        className="item-slot"
        aria-pressed={selected}
        aria-label={[item.name, quantity > 1 && quantity, note]
          .filter(Boolean)
          .join(', ')}
        onClick={onSelect}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        <ItemIcon spriteId={item.sprite} />
        {quantity > 1 && (
          <span className="item-slot-quantity" aria-hidden="true">
            {quantity}
          </span>
        )}
      </button>
      {box && (
        <span
          role="tooltip"
          className="hotbar-tooltip item-tooltip"
          style={{
            left: Math.min(
              Math.max(box.left + box.width / 2, TOOLTIP_HALF),
              window.innerWidth - TOOLTIP_HALF,
            ),
            top: box.top - 8,
          }}
        >
          <strong>{item.name}</strong>
          <span>
            {[itemType(t, item), effects, quantity > 1 && `x${quantity}`]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {note && <span>{note}</span>}
        </span>
      )}
    </>
  );
};
