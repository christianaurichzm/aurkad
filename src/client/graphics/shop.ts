import { getSpriteCoordinates, renderInventory } from './inventory';
import { fetchShop, buyShopItem } from '../io/network';
import { getPlayer } from '../core/gameState';
import { ITEM_SIZE } from '../../shared/constants';
import { items } from '../io/files';
import { createModal } from '../ui/createModal';
import { ProductDetailed } from '../../shared/types';

export async function openShopWindow(shopId: string) {
  const content = document.createElement('div');
  content.style.display = 'flex';
  content.style.flexDirection = 'column';
  content.style.gap = '12px';

  const modal = createModal({
    title: 'Shop',
    content,
    width: 520,
    onClose: () => console.log('Closed shop'),
  });

  try {
    const shop = await fetchShop(shopId);
    if (!shop) {
      content.innerText = 'Shop not found.';
      return;
    }

    shop.products.forEach((product: ProductDetailed) => {
      const item = document.createElement('div');
      item.style.display = 'flex';
      item.style.alignItems = 'center';
      item.style.justifyContent = 'space-between';
      item.style.background = '#f5f5f5';
      item.style.border = '1px solid #ddd';
      item.style.padding = '8px 12px';
      item.style.borderRadius = '8px';

      const info = document.createElement('div');
      info.style.display = 'flex';
      info.style.alignItems = 'center';
      info.style.gap = '10px';

      const itemCanvas = document.createElement('canvas');
      itemCanvas.width = 36;
      itemCanvas.height = 36;
      renderShopItemPreview(product.item.sprite, itemCanvas);

      const label = document.createElement('div');
      label.style.display = 'flex';
      label.style.flexDirection = 'column';

      const name = document.createElement('strong');
      name.textContent = product.item.name;

      const price = document.createElement('div');
      price.style.display = 'flex';
      price.style.alignItems = 'center';
      price.style.gap = '6px';

      const coinCanvas = document.createElement('canvas');
      coinCanvas.width = 24;
      coinCanvas.height = 24;
      renderShopItemPreview(product.currency.sprite, coinCanvas);

      const priceText = document.createElement('span');
      priceText.textContent = `${product.price}x ${product.currency.name}`;

      price.appendChild(coinCanvas);
      price.appendChild(priceText);
      label.appendChild(name);
      label.appendChild(price);

      info.appendChild(itemCanvas);
      info.appendChild(label);

      const buyBtn = document.createElement('button');
      buyBtn.textContent = 'Buy';
      buyBtn.style.padding = '4px 10px';
      buyBtn.style.background = '#4caf50';
      buyBtn.style.color = '#fff';
      buyBtn.style.border = 'none';
      buyBtn.style.borderRadius = '6px';
      buyBtn.style.cursor = 'pointer';
      buyBtn.onclick = async () => {
        buyBtn.disabled = true;
        buyBtn.textContent = '...';
        const result = await buyShopItem(shop.id, product.item.id).catch(
          () => null,
        );
        if (result?.success) {
          const player = getPlayer();
          if (player) {
            renderInventory(player);
            modal.close();
          }
        } else {
          alert(result?.message || 'Error while purchasing.');
          buyBtn.textContent = 'Buy';
        }
        buyBtn.disabled = false;
      };

      item.appendChild(info);
      item.appendChild(buyBtn);
      content.appendChild(item);
    });
  } catch {
    content.innerText = 'Error loading the shop.';
  }
}

function renderShopItemPreview(spriteId: number, canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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
    0,
    0,
    canvas.width,
    canvas.height,
  );
}
