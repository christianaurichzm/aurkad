import { ITEM_SIZE } from '../../shared/constants';
import { ClientItemAction, Item, Player } from '../../shared/types';
import { getPlayer } from '../core/gameState';
import { items } from '../io/files';
import { sendAction } from '../io/network';

const inventoryContainer = document.getElementById(
  'inventory',
) as HTMLDivElement;
let isInventoryOpen = false;
let selectedItem: Item | null = null;
let previousInventory: Item[] = [];
let previousSelectedItem: Item | null = null;

const getSpriteCoordinates = (spriteId: number, sheetWidth: number) => {
  const cols = sheetWidth / ITEM_SIZE;
  const x = (spriteId % cols) * ITEM_SIZE;
  const y = Math.floor(spriteId / cols) * ITEM_SIZE;
  return { x, y };
};

const renderItemIcon = (
  ctx: CanvasRenderingContext2D,
  spriteId: number,
  x: number,
  y: number,
  sheetWidth: number,
) => {
  const { x: spriteX, y: spriteY } = getSpriteCoordinates(spriteId, sheetWidth);
  ctx.drawImage(
    items,
    spriteX,
    spriteY,
    ITEM_SIZE,
    ITEM_SIZE,
    x,
    y,
    ITEM_SIZE,
    ITEM_SIZE,
  );
};

export function selectItem(item: Item): void {
  selectedItem = item;
  renderInventory(getPlayer());
}

export function renderInventory(player: Player) {
  const itemsContainer = document.getElementById('items');
  const tooltip = document.getElementById('tooltip');
  const useButtonContainer = document.getElementById('use-button-container');

  if (!itemsContainer || !tooltip || !useButtonContainer) return;

  const currentInventory = player.inventory.items;
  const inventoryChanged =
    currentInventory.length !== previousInventory.length ||
    currentInventory.some(
      (item, index) => item.id !== previousInventory[index]?.id,
    );

  if (inventoryChanged || selectedItem !== previousSelectedItem) {
    previousInventory = [...currentInventory];
    previousSelectedItem = selectedItem;

    itemsContainer.innerHTML = '';
    currentInventory.forEach((item) => {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'item';
      itemDiv.style.border =
        selectedItem && selectedItem.id === item.id
          ? '2px solid red'
          : isItemEquipped(player, item)
            ? '2px solid green'
            : '1px solid #ddd';

      const itemCanvas = document.createElement('canvas');
      itemCanvas.width = ITEM_SIZE;
      itemCanvas.height = ITEM_SIZE;
      const itemCtx = itemCanvas.getContext('2d');
      if (itemCtx) {
        renderItemIcon(itemCtx, item.sprite, 0, 0, items?.width);
      }

      itemDiv.appendChild(itemCanvas);

      itemDiv.onmouseover = () => {
        tooltip.style.display = 'block';
        tooltip.innerHTML = `<h3>${item.name}</h3><p>${item.description}</p>`;
      };

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
    useButton.textContent = 'Use Item';
    useButton.disabled = !selectedItem;
    useButton.onclick = () => {
      if (selectedItem) {
        sendAction({
          type: 'item',
          action: 'use',
          item: selectedItem.id,
        } as ClientItemAction);
        selectedItem = null;
        renderInventory(player);
      }
    };
    useButtonContainer.appendChild(useButton);
  }
}

function isItemEquipped(player: Player, item: Item): boolean {
  return (
    player.equipped.weapon?.id === item.id ||
    player.equipped.armor?.id === item.id
  );
}

export const toggleInventory = () => {
  if (inventoryContainer) {
    isInventoryOpen = !isInventoryOpen;
    inventoryContainer.style.display = isInventoryOpen ? 'block' : 'none';

    if (isInventoryOpen) {
      renderInventory(getPlayer());
    }
  }
};
