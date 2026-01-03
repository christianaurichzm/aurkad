import React, { useEffect, useState } from 'react';
import type { Item } from '../../../shared/types';
import { sendAction } from '../../io/network';
import { EquipmentPanel } from './EquipmentPanel';
import { ItemIcon } from './ItemIcon';
import { useStyles } from './styles';
import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';
import { isEquipped } from '../../utils/isEquipped';

type Selection = { item: Item; quantity: number };

export const InventoryPanel: React.FC = () => {
  const styles = useStyles();
  const [selected, setSelected] = useState<Selection | null>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    item: Item;
    qty: number;
  } | null>(null);

  const [visible, setVisible] = useState(false);
  const player = usePlayerForceUpdate(visible);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleInventory', onToggle);
    return () => window.removeEventListener('toggleInventory', onToggle);
  }, []);

  useEffect(() => {
    if (!selected || !player) return;
    const isEquippedItem = isEquipped(player, selected.item.id);
    const inInv = player.inventory.some((i) => i.item.id === selected.item.id);
    if (!isEquippedItem && !inInv) setSelected(null);
  }, [player, selected]);

  const equippedSlot =
    player && selected
      ? Object.entries(player.equipped).find(
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
    sendAction({
      type: 'item',
      action: 'drop',
      item: selected.item.id,
    });
    setSelected(null);
  };

  const selectItemByEquip = (sel: Selection) => setSelected(sel);

  const labelPrimary = () => {
    if (!selected) return 'Use';
    if (selected.item.type === 'consumable') return 'Use';
    if (!player) return 'Equip';
    return isEquipped(player, selected.item.id) ? 'Use (Unequip)' : 'Equip';
  };

  if (!player) return null;

  if (!visible) return null;

  return (
    <div style={styles.container}>
      <EquipmentPanel selectItem={selectItemByEquip} />
      <div style={styles.panel}>
        <div style={styles.title}>Inventory</div>
        <div style={styles.grid}>
          {player.inventory.map((inv) => {
            const border =
              selected?.item.id === inv.item.id
                ? '2px solid #e67e22'
                : isEquipped(player, inv.item.id)
                  ? '2px solid #2ecc40'
                  : '1px solid #333';
            return (
              <div
                key={inv.item.id}
                style={styles.cell(border)}
                onMouseEnter={(e) =>
                  setTooltip({
                    x: e.clientX,
                    y: e.clientY,
                    item: inv.item,
                    qty: inv.quantity,
                  })
                }
                onMouseMove={(e) =>
                  tooltip &&
                  setTooltip({ ...tooltip, x: e.clientX, y: e.clientY })
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
              </div>
            );
          })}
        </div>
        <div style={styles.row}>
          <button
            style={styles.useBtn(!!selected)}
            disabled={!selected}
            onClick={handlePrimary}
          >
            {labelPrimary()}
          </button>
          <button
            style={styles.dropBtn(!!selected && !(!!equippedSlot && selected))}
            disabled={!selected || !!equippedSlot}
            onClick={handleDrop}
          >
            Drop
          </button>
        </div>
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
            {tooltip.qty > 1 && <div>Quantity: {tooltip.qty}</div>}
          </div>
        )}
      </div>
    </div>
  );
};
