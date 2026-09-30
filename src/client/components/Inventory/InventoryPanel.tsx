import React, { useEffect, useState } from 'react';
import { EQUIPMENT_SLOTS } from '../../../shared/constants';
import type { Item, Player } from '../../../shared/types';
import { sendAction } from '../../io/network';
import { EquipmentPanel } from './EquipmentPanel';
import {
  ItemComparison,
  ItemIcon,
  ItemSlot,
  itemEffects,
  itemType,
  wornInPlaceOf,
} from './ItemIcon';
import { EmptyState } from '../common/EmptyState';
import { Modal } from '../common/Modal';
import { Stepper } from '../common/Stepper';
import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';
import { useT } from '../../i18n';

type InventoryTab = 'bag' | 'equipment';

const COLUMNS = 5;
const ARROWS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -COLUMNS,
  ArrowDown: COLUMNS,
};

// The arrows walk the items, in the rows they are laid out in.
const walkGrid = (e: React.KeyboardEvent<HTMLDivElement>) => {
  const step = ARROWS[e.key];
  if (!step) return;
  const slots = [...e.currentTarget.querySelectorAll('button')];
  const next = slots[slots.indexOf(e.target as HTMLButtonElement) + step];
  if (!next) return;
  e.preventDefault();
  next.focus();
};

export const InventoryPanel: React.FC = () => {
  const t = useT();
  const [selected, setSelected] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<InventoryTab>('bag');
  // Null until Drop is pressed; then how many, waiting to be confirmed.
  const [dropQuantity, setDropQuantity] = useState<number | null>(null);

  const [visible, setVisible] = useState(false);
  // While the trade window is open, a picked item can be put on offer there.
  const [tradeMode, setTradeMode] = useState(false);
  const player = usePlayerForceUpdate(visible);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    const onTradeActive = () => setTradeMode(true);
    const onTradeInactive = () => setTradeMode(false);
    window.addEventListener('toggleInventory', onToggle);
    window.addEventListener('trade:active', onTradeActive);
    window.addEventListener('trade:inactive', onTradeInactive);
    return () => {
      window.removeEventListener('toggleInventory', onToggle);
      window.removeEventListener('trade:active', onTradeActive);
      window.removeEventListener('trade:inactive', onTradeInactive);
    };
  }, []);

  if (!player || !visible) return null;

  const select = (id: number | null) => {
    setSelected(id);
    setDropQuantity(null);
  };
  const toggle = (id: number) => select(selected === id ? null : id);

  // Looked up every render, so an item used up, worn or dropped stops being
  // selected on its own.
  const held =
    activeTab === 'bag'
      ? player.inventory.find((entry) => entry.item.id === selected)
      : undefined;
  const worn =
    activeTab === 'equipment'
      ? EQUIPMENT_SLOTS.map((slot) => player.equipped[slot]).find(
          (item) => item?.id === selected,
        )
      : undefined;
  const item = held?.item ?? worn;

  // A bag already over a capacity that was lowered still shows all it holds.
  const capacity = Math.max(player.inventoryCapacity, player.inventory.length);

  return (
    <Modal
      floating
      size="regular"
      className="inventory-panel"
      title={t('inventory.title')}
      counter={`${player.inventory.length}/${capacity}`}
      onClose={() => setVisible(false)}
      footer={
        item ? (
          <ItemDetail
            key={`${activeTab}-${item.id}`}
            player={player}
            item={item}
            quantity={held?.quantity ?? 1}
            worn={!!worn}
            tradeMode={tradeMode}
            dropQuantity={dropQuantity}
            setDropQuantity={setDropQuantity}
          />
        ) : (
          <p className="item-detail-hint">{t('inventory.selectHint')}</p>
        )
      }
    >
      <div
        className="window-tabs"
        role="tablist"
        aria-label={t('inventory.title')}
      >
        {(
          [
            ['bag', t('inventory.bag')],
            ['equipment', t('inventory.equipment')],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => {
              setActiveTab(tab);
              select(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'equipment' ? (
        <EquipmentPanel player={player} selected={selected} onSelect={toggle} />
      ) : player.inventory.length === 0 ? (
        <EmptyState
          icon="bag"
          title={t('inventory.bagEmpty')}
          hint={t('inventory.bagEmptyHint')}
        />
      ) : (
        <div
          className="bag-grid"
          role="group"
          aria-label={t('inventory.bagSlots', {
            count: player.inventory.length,
            capacity,
          })}
          onKeyDown={walkGrid}
        >
          {player.inventory.map((entry) => (
            <ItemSlot
              key={entry.item.id}
              item={entry.item}
              quantity={entry.quantity}
              selected={selected === entry.item.id}
              onSelect={() => toggle(entry.item.id)}
            />
          ))}
          {Array.from(
            { length: capacity - player.inventory.length },
            (_, i) => (
              <span key={i} className="item-slot" data-empty aria-hidden />
            ),
          )}
        </div>
      )}
    </Modal>
  );
};

const ItemDetail = ({
  player,
  item,
  quantity,
  worn,
  tradeMode,
  dropQuantity,
  setDropQuantity,
}: {
  player: Player;
  item: Item;
  quantity: number;
  worn: boolean;
  tradeMode: boolean;
  dropQuantity: number | null;
  setDropQuantity: (quantity: number | null) => void;
}) => {
  const t = useT();
  const effects = itemEffects(t, item);
  const inPlace = !worn && wornInPlaceOf(player, item);

  // Taking it off needs somewhere to put it: a stack of the same, or a slot.
  const noRoom =
    worn &&
    player.inventory.length >= player.inventoryCapacity &&
    !player.inventory.some((entry) => entry.item.id === item.id);

  const primary =
    item.type === 'consumable'
      ? t('inventory.use')
      : item.type === 'money'
        ? null
        : worn
          ? t('inventory.unequip')
          : t('inventory.equip');

  return (
    <div className="item-detail" aria-live="polite">
      <div className="item-detail-head">
        <ItemIcon spriteId={item.sprite} />
        <div>
          <h3>
            {item.name}
            {quantity > 1 && (
              <span className="item-detail-quantity"> x{quantity}</span>
            )}
          </h3>
          <p className="item-detail-type">
            {[itemType(t, item), worn && t('inventory.equipped')]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {item.description && <p>{item.description}</p>}
          {effects && <p className="item-detail-effect">{effects}</p>}
          {inPlace && <ItemComparison item={item} inPlace={inPlace} />}
          {item.bound && (
            <p className="item-detail-note">{t('inventory.bound')}</p>
          )}
          {noRoom && (
            <p className="item-detail-note">
              {t(
                item.bound
                  ? 'inventory.unequipFullBound'
                  : 'inventory.unequipFull',
              )}
            </p>
          )}
        </div>
      </div>

      {dropQuantity === null ? (
        <div className="window-actions">
          {primary && (
            <button
              type="button"
              className="button-primary"
              onClick={() =>
                sendAction({ type: 'item', action: 'use', item: item.id })
              }
            >
              {primary}
            </button>
          )}
          {tradeMode && !worn && !item.bound && (
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('inventory:item-for-trade', {
                    detail: { itemId: item.id, quantity },
                  }),
                )
              }
            >
              {t('inventory.offerInTrade')}
            </button>
          )}
          {!worn && !item.bound && (
            <button type="button" onClick={() => setDropQuantity(1)}>
              {t('inventory.drop')}
            </button>
          )}
        </div>
      ) : (
        <div
          className="item-drop"
          role="group"
          aria-label={t('inventory.drop')}
        >
          <span>
            {quantity > 1
              ? t('inventory.dropHowMany')
              : t('inventory.dropOne', { item: item.name })}
          </span>
          {quantity > 1 && (
            <Stepper
              value={dropQuantity}
              max={quantity}
              onChange={setDropQuantity}
              label={t('inventory.dropHowMany')}
            />
          )}
          <button
            type="button"
            className="button-danger"
            onClick={() => {
              sendAction({
                type: 'item',
                action: 'drop',
                item: item.id,
                quantity: dropQuantity,
              });
              setDropQuantity(null);
            }}
          >
            {quantity > 1
              ? t('inventory.dropCount', { count: dropQuantity })
              : t('inventory.drop')}
          </button>
          <button type="button" onClick={() => setDropQuantity(null)}>
            {t('common.cancel')}
          </button>
        </div>
      )}
    </div>
  );
};
