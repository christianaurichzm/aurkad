import React, { useEffect, useState } from 'react';
import type { Item } from '../../../shared/types';
import { sendAction } from '../../io/network';
import { EquipmentPanel } from './EquipmentPanel';
import { ItemIcon } from './ItemIcon';
import { useStyles } from './styles';
import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';
import { isEquipped } from '../../utils/isEquipped';
import { colors } from '../../theme';
import { useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useT } from '../../i18n';

type Selection = { item: Item; quantity: number };
type InventoryTab = 'bag' | 'equipment';

export const InventoryPanel: React.FC = () => {
  const t = useT();
  const styles = useStyles();
  const { ref, pos, onPointerDown } = useDraggable(24, 120);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [activeTab, setActiveTab] = useState<InventoryTab>('bag');
  const [dropTarget, setDropTarget] = useState<Selection | null>(null);
  const [dropQuantity, setDropQuantity] = useState('1');
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    item: Item;
    qty: number;
  } | null>(null);

  const [visible, setVisible] = useState(false);
  const [tradeMode, setTradeMode] = useState(false);
  const player = usePlayerForceUpdate(visible);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    const onTradeActive = () => {
      setVisible(true);
      setTradeMode(true);
    };
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

  useEscapeClose(visible, () => setVisible(false));

  useEffect(() => {
    if (!selected || !player) return;
    const isEquippedItem = isEquipped(player, selected.item.id);
    const inInv = player.inventory.some((i) => i.item.id === selected.item.id);
    if (!isEquippedItem && !inInv) setSelected(null);
  }, [player, selected]);

  const equippedSlot =
    player && selected
      ? (Object.entries(player.equipped) as [string, Item | undefined][]).find(
          ([, eq]) => eq?.id === selected.item.id,
        )?.[0]
      : null;

  const handlePrimary = () => {
    if (!player || !selected) return;
    sendAction({
      type: 'item',
      action: 'use',
      item: selected.item.id,
    });
    setSelected(null);
  };

  const handleDrop = () => {
    if (!player || !selected) return;
    if (selected.quantity > 1) {
      setDropTarget(selected);
      setDropQuantity('1');
      return;
    }

    dropSelectedItem(selected, 1);
  };

  const dropSelectedItem = (selection: Selection, quantity: number) => {
    sendAction({
      type: 'item',
      action: 'drop',
      item: selection.item.id,
      quantity,
    });
    setSelected(null);
    setDropTarget(null);
  };

  const selectItemByEquip = (sel: Selection) => setSelected(sel);

  const labelPrimary = () => {
    if (!selected) return t('inventory.use');
    if (selected.item.type === 'consumable') return t('inventory.use');
    if (!player) return t('inventory.equip');
    return isEquipped(player, selected.item.id)
      ? t('inventory.unequip')
      : t('inventory.equip');
  };

  const showTooltip = (item: Item, qty: number, x: number, y: number) =>
    setTooltip({ x, y, item, qty });

  const moveTooltip = (x: number, y: number) =>
    setTooltip((current) => (current ? { ...current, x, y } : current));

  const confirmDropQuantity = () => {
    if (!dropTarget) return;
    const parsedQuantity = Number(dropQuantity || 1);
    const quantity = Math.max(
      1,
      Math.min(Math.floor(parsedQuantity), dropTarget.quantity),
    );
    dropSelectedItem(dropTarget, quantity);
  };

  if (!player) return null;

  if (!visible) return null;

  return (
    <div
      ref={ref}
      className="inventory-window"
      role="dialog"
      aria-label={t('inventory.title')}
      style={{ ...styles.container, left: pos.x, top: pos.y }}
    >
      <div className="inventory-panel" style={styles.panel}>
        <div
          className="window-titlebar"
          style={styles.header}
          onPointerDown={onPointerDown}
        >
          <div style={styles.title}>{t('inventory.title')}</div>
          <button
            type="button"
            aria-label={t('common.close')}
            className="window-close"
            style={styles.closeBtn}
            onClick={() => setVisible(false)}
          >
            ×
          </button>
        </div>
        <div style={styles.tabs}>
          {[
            ['bag', t('inventory.bag')],
            ['equipment', t('inventory.equipment')],
          ].map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              style={styles.tabBtn(activeTab === tab)}
              aria-pressed={activeTab === tab}
              onClick={() => {
                setActiveTab(tab as InventoryTab);
                setSelected(null);
                setTooltip(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'bag' ? (
          player.inventory.length > 0 ? (
            <div style={styles.grid}>
              {player.inventory.map((inv) => {
                const border =
                  selected?.item.id === inv.item.id
                    ? `2px solid ${colors.warning}`
                    : isEquipped(player, inv.item.id)
                      ? `2px solid ${colors.primary}`
                      : `1px solid ${colors.border}`;
                return (
                  <div
                    key={inv.item.id}
                    style={styles.cell(border)}
                    title={inv.item.name}
                    onMouseEnter={(e) =>
                      setTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        item: inv.item,
                        qty: inv.quantity,
                      })
                    }
                    onMouseMove={(e) =>
                      tooltip && moveTooltip(e.clientX, e.clientY)
                    }
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() =>
                      setSelected({ item: inv.item, quantity: inv.quantity })
                    }
                  >
                    <ItemIcon spriteId={inv.item.sprite} />
                    {inv.quantity > 1 && (
                      <span style={styles.qty}>{inv.quantity}</span>
                    )}
                    {tradeMode && (
                      <button
                        type="button"
                        style={tradeSelectBtn}
                        title={t('inventory.offerInTrade')}
                        onClick={(e) => {
                          e.stopPropagation();
                          window.dispatchEvent(
                            new CustomEvent('inventory:item-for-trade', {
                              detail: {
                                itemId: inv.item.id,
                                quantity: inv.quantity,
                              },
                            }),
                          );
                        }}
                      >
                        +
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={styles.emptyState}>{t('inventory.bagEmpty')}</div>
          )
        ) : (
          <EquipmentPanel
            player={player}
            selectItem={selectItemByEquip}
            onItemHover={showTooltip}
            onItemHoverMove={moveTooltip}
            onItemHoverLeave={() => setTooltip(null)}
          />
        )}

        {activeTab === 'bag' && selected && (
          <div style={styles.selectedItem}>
            <strong>{selected.item.name}</strong>
            <span>{selected.item.description}</span>
            {selected.quantity > 1 && (
              <span>
                {t('inventory.quantity', { count: selected.quantity })}
              </span>
            )}
          </div>
        )}

        <div style={styles.row}>
          <button
            style={styles.useBtn(!!selected)}
            disabled={!selected}
            onClick={handlePrimary}
          >
            {labelPrimary()}
          </button>
          <button
            style={styles.dropBtn(
              !!selected && !equippedSlot && !selected.item.bound,
            )}
            disabled={!selected || !!equippedSlot || !!selected?.item.bound}
            onClick={handleDrop}
          >
            {t('inventory.drop')}
          </button>
        </div>
        {dropTarget && (
          <div
            className="inventory-drop-backdrop"
            style={styles.dropPromptBackdrop}
          >
            <div className="inventory-drop-sheet" style={styles.dropPrompt}>
              <strong>{t('inventory.dropQuantity')}</strong>
              <span>
                {t('inventory.available', {
                  item: dropTarget.item.name,
                  count: dropTarget.quantity,
                })}
              </span>
              <input
                type="number"
                min={1}
                max={dropTarget.quantity}
                value={dropQuantity}
                style={styles.dropQuantityInput}
                onChange={(event) => setDropQuantity(event.target.value)}
                autoFocus
              />
              <div style={styles.dropPromptActions}>
                <button
                  type="button"
                  style={styles.cancelDropBtn}
                  onClick={() => setDropTarget(null)}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  style={styles.confirmDropBtn}
                  onClick={confirmDropQuantity}
                >
                  {t('inventory.drop')}
                </button>
              </div>
            </div>
          </div>
        )}
        {tooltip && (
          <div
            style={{
              ...styles.tooltip,
              top: tooltip.y + 13,
              left: tooltip.x + 14,
            }}
          >
            <strong>{tooltip.item.name}</strong>
            <div>{tooltip.item.description}</div>
            {tooltip.qty > 1 && (
              <div>{t('inventory.quantity', { count: tooltip.qty })}</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

const tradeSelectBtn: React.CSSProperties = {
  position: 'absolute',
  bottom: 1,
  right: 1,
  width: 14,
  height: 14,
  fontSize: 10,
  lineHeight: '14px',
  textAlign: 'center',
  padding: 0,
  border: 'none',
  borderRadius: 2,
  background: colors.primary,
  color: '#fff',
  cursor: 'pointer',
  zIndex: 1,
};
