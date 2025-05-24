import { getEl } from '../../server/domHelpers';
import { EQUIPMENT_SLOTS, ITEM_SIZE, TILE_SIZE } from '../../shared/constants';
import {
  ClientItemAction,
  InventoryItemDetailed,
  Item,
  Player,
} from '../../shared/types';
import { getPlayer } from '../core/gameState';
import { items } from '../io/files';
import { sendAction } from '../io/network';

let isInventoryOpen = false;
let selectedItem: InventoryItemDetailed | null = null;
let previousInventory: InventoryItemDetailed[] = [];
let previousSelectedItem: InventoryItemDetailed | null = null;
let previousEquipment: Player['equipped'] | null = null;

export const getSpriteCoordinates = (spriteId: number, sheetWidth: number) => {
  const cols = sheetWidth / ITEM_SIZE;
  const x = (spriteId % cols) * ITEM_SIZE;
  const y = Math.floor(spriteId / cols) * ITEM_SIZE;
  return { x, y };
};

/**
 * Render an item icon filling all the canvas (for previews, etc)
 *
 * @param ctx CanvasRenderingContext2D
 * @param spriteId Index of the item sprite in the items sheet
 * @param destX Top-left X (usually 0 for preview)
 * @param destY Top-left Y (usually 0 for preview)
 * @param destW Width to fill (usually canvas.width)
 * @param destH Height to fill (usually canvas.height)
 */
export function drawItemGeneric(
  ctx: CanvasRenderingContext2D,
  spriteId: number,
  destX: number,
  destY: number,
  destW: number,
  destH: number,
) {
  const { x: spriteX, y: spriteY } = getSpriteCoordinates(
    spriteId,
    items.naturalWidth,
  );

  ctx.drawImage(
    items,
    spriteX,
    spriteY,
    ITEM_SIZE,
    ITEM_SIZE,
    destX,
    destY,
    destW,
    destH,
  );
}

export const renderItemIcon = (
  ctx: CanvasRenderingContext2D,
  spriteId: number,
  x: number,
  y: number,
  applyOffset: boolean = true,
) => {
  const { x: spriteX, y: spriteY } = getSpriteCoordinates(
    spriteId,
    items?.width,
  );

  const offsetX = applyOffset ? (TILE_SIZE - ITEM_SIZE) / 2 : 0;
  const offsetY = applyOffset ? (TILE_SIZE - ITEM_SIZE) / 2 : 0;

  ctx.drawImage(
    items,
    spriteX,
    spriteY,
    ITEM_SIZE,
    ITEM_SIZE,
    x + offsetX,
    y + offsetY,
    ITEM_SIZE,
    ITEM_SIZE,
  );
};

export function selectItem(item: InventoryItemDetailed): void {
  selectedItem = item;
  const player = getPlayer();

  if (player) {
    renderInventory(player);
  }
}

export function renderInventory(player: Player) {
  const itemsContainer = getEl<HTMLDivElement>('items');
  const tooltip = getEl<HTMLDivElement>('tooltip');
  const useButtonContainer = getEl<HTMLDivElement>('use-button-container');

  if (!itemsContainer || !tooltip || !useButtonContainer) return;

  const currentInventory = player.inventory;
  const inventoryChanged =
    currentInventory.length !== previousInventory.length ||
    currentInventory.some(
      (item, index) =>
        item.item.id !== previousInventory[index]?.item.id ||
        item.quantity !== previousInventory[index]?.quantity,
    );

  if (inventoryChanged || selectedItem !== previousSelectedItem) {
    previousInventory = [...currentInventory];
    previousSelectedItem = selectedItem;

    itemsContainer.innerHTML = '';
    currentInventory.forEach((item) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'item';
      itemDiv.style.border =
        selectedItem && selectedItem.item.id === item.item.id
          ? '2px solid red'
          : isItemEquipped(player, item.item)
            ? '2px solid green'
            : '1px solid #ddd';

      const itemCanvas = document.createElement('canvas');
      itemCanvas.width = ITEM_SIZE;
      itemCanvas.height = ITEM_SIZE;
      const itemCtx = itemCanvas.getContext('2d');
      if (itemCtx) {
        renderItemIcon(itemCtx, item.item.sprite, 0, 0, false);
      }

      itemDiv.appendChild(itemCanvas);

      itemDiv.onmouseover = () => {
        tooltip.style.display = 'block';
        tooltip.innerHTML = `<h3>${item.item.name}</h3><p>${item.item.description}</p>${
          item.quantity > 1 ? `<p>Quantity: ${item.quantity}</p>` : ''
        }`;
      };

      if (item.quantity > 1) {
        const quantityLabel = document.createElement('span');
        quantityLabel.style.position = 'absolute';
        quantityLabel.style.top = '2px';
        quantityLabel.style.right = '4px';
        quantityLabel.style.fontSize = '12px';
        quantityLabel.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
        quantityLabel.style.color = 'white';
        quantityLabel.style.padding = '1px 4px';
        quantityLabel.style.borderRadius = '4px';
        quantityLabel.style.pointerEvents = 'none';
        itemDiv.style.position = 'relative';
        quantityLabel.textContent = `${item.quantity}`;
        itemDiv.appendChild(quantityLabel);
      }

      itemDiv.onmousemove = (event) => {
        tooltip.style.top = `${event.clientY + 10}px`;
        tooltip.style.left = `${event.clientX + 10}px`;
      };

      itemDiv.onmouseout = () => {
        tooltip.style.display = 'none';
      };

      itemDiv.onclick = () => selectItem(item);

      itemsContainer.appendChild(itemDiv);
    });

    useButtonContainer.innerHTML = '';
    const useButton = document.createElement('button');
    if (selectedItem) {
      const isEquipped = isItemEquipped(player, selectedItem.item);
      useButton.textContent = isEquipped ? 'Desequipar' : 'Usar Item';
    } else {
      useButton.textContent = 'Usar Item';
    }

    useButton.disabled = !selectedItem;
    useButton.onclick = async () => {
      if (selectedItem) {
        await sendAction({
          type: 'item',
          action: 'use',
          item: selectedItem.item.id,
        } as ClientItemAction);

        selectedItem = null;

        renderInventory(player);
        renderEquipment(player);
      }
    };

    useButtonContainer.appendChild(useButton);
  }
}

function isItemEquipped(player: Player, item: Item): boolean {
  return (
    player.equipped.weapon?.id === item.id ||
    player.equipped.helmet?.id === item.id ||
    player.equipped.chestplate?.id === item.id ||
    player.equipped.gloves?.id === item.id ||
    player.equipped.boots?.id === item.id
  );
}

export const toggleInventory = () => {
  const inventoryContainer = getEl<HTMLDivElement>('inventory');
  if (inventoryContainer) {
    isInventoryOpen = !isInventoryOpen;
    inventoryContainer.style.display = isInventoryOpen ? 'block' : 'none';

    if (isInventoryOpen) {
      const player = getPlayer();
      if (!player) return;
      renderInventory(player);
      renderEquipment(player);
    }
  }
};

export function renderEquipment(player: Player) {
  const equipmentContainer = getEl<HTMLDivElement>('equipment');
  const tooltip = getEl<HTMLDivElement>('tooltip');
  const useButtonContainer = getEl<HTMLDivElement>('use-button-container');

  if (!equipmentContainer || !tooltip || !useButtonContainer) return;

  const currentEquipment = player.equipped;

  const equipmentChanged =
    !previousEquipment ||
    EQUIPMENT_SLOTS.some((slot) => {
      const key = slot as keyof Player['equipped'];
      const prevId = previousEquipment?.[key]?.id ?? null;
      const currId = currentEquipment[key]?.id ?? null;
      return prevId !== currId;
    });

  if (!equipmentChanged) return;

  previousEquipment = { ...currentEquipment };

  equipmentContainer.innerHTML = '';

  const createSlot = (item: Item | undefined, slotClass: string) => {
    const slot = document.createElement('div');
    slot.className = `equipment-slot ${slotClass}`;
    slot.style.border = '1px solid #ddd';

    if (item) {
      const itemCanvas = document.createElement('canvas');
      itemCanvas.width = ITEM_SIZE;
      itemCanvas.height = ITEM_SIZE;
      const itemCtx = itemCanvas.getContext('2d');
      if (itemCtx) {
        renderItemIcon(itemCtx, item.sprite, 0, 0, false);
      }
      slot.appendChild(itemCanvas);

      slot.onmouseover = (e) => {
        tooltip.style.display = 'block';
        tooltip.innerHTML = `<h3>${item.name}</h3><p>${item.description}</p>`;
        tooltip.style.top = `${e.clientY + 10}px`;
        tooltip.style.left = `${e.clientX + 10}px`;
      };

      slot.onmousemove = (e) => {
        tooltip.style.top = `${e.clientY + 10}px`;
        tooltip.style.left = `${e.clientX + 10}px`;
      };

      slot.onmouseout = () => {
        tooltip.style.display = 'none';
      };

      slot.onclick = () => {
        selectedItem = { item, quantity: 1 };
        renderInventory(player);
        renderEquipment(player);
      };
    }

    return slot;
  };

  equipmentContainer.appendChild(createSlot(player.equipped.helmet, 'helmet'));
  equipmentContainer.appendChild(
    createSlot(player.equipped.chestplate, 'chestplate'),
  );
  equipmentContainer.appendChild(createSlot(player.equipped.weapon, 'weapon'));
  equipmentContainer.appendChild(createSlot(player.equipped.gloves, 'gloves'));
  equipmentContainer.appendChild(createSlot(player.equipped.boots, 'boots'));
}
