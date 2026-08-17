import { useRef, useState, useEffect } from 'react';
import { ITEM_SIZE } from '../../../shared/constants';
import { ProductDetailed } from '../../../shared/types';
import { updatePlayerInventory } from '../../core/gameState';
import { drawItemGeneric } from '../../graphics/render';
import { buyShopItem, httpError } from '../../io/network';
import { useUIStore } from '../../stores/uiStore';
import { colors, radius } from '../../theme';
import { useT } from '../../i18n';

interface ShopRowProps {
  shopId: string;
  product: ProductDetailed;
  onBought?: () => void;
}

export const ShopRow: React.FC<ShopRowProps> = ({
  shopId,
  product,
  onBought,
}) => {
  const t = useT();
  const itemCanvas = useRef<HTMLCanvasElement>(null);
  const coinCanvas = useRef<HTMLCanvasElement>(null);
  const [buying, setBuying] = useState(false);

  useEffect(() => {
    const c = itemCanvas.current;
    if (c)
      drawItemGeneric(
        c.getContext('2d')!,
        product.item.sprite,
        0,
        0,
        c.width,
        c.height,
      );
  }, [product.item.sprite]);

  useEffect(() => {
    const c = coinCanvas.current;
    if (c)
      drawItemGeneric(
        c.getContext('2d')!,
        product.currency.sprite,
        0,
        0,
        c.width,
        c.height,
      );
  }, [product.currency.sprite]);

  const handleBuy = async () => {
    setBuying(true);
    try {
      const res = await buyShopItem(shopId, product.item.id);
      if (!res?.success) {
        throw new Error(res?.message || 'Error purchasing.');
      }

      if (res.inventory) {
        updatePlayerInventory(res.inventory);
      }

      useUIStore.getState().addChatMessage({
        message: res.message || `${product.item.name} purchased.`,
        scope: 'player',
        type: 'chat',
      });
      onBought?.();
    } catch (error) {
      await useUIStore.getState().showDialog({
        title: 'Purchase failed',
        message: httpError(error).message || 'Error purchasing.',
        kind: 'error',
      });
    } finally {
      setBuying(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: colors.surfaceMuted,
        border: `1px solid ${colors.border}`,
        padding: 8,
        borderRadius: radius.lg,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <canvas ref={itemCanvas} width={ITEM_SIZE} height={ITEM_SIZE} />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <strong>{product.item.name}</strong>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <canvas ref={coinCanvas} width={ITEM_SIZE} height={ITEM_SIZE} />
            <span>
              {product.price} × {product.currency.name}
            </span>
          </div>
        </div>
      </div>
      <button
        onClick={handleBuy}
        disabled={buying}
        style={{
          padding: '4px 10px',
          background: colors.primary,
          color: '#fff',
          border: 'none',
          borderRadius: radius.md,
          cursor: 'pointer',
        }}
      >
        {buying ? '…' : t('shop.buy')}
      </button>
    </div>
  );
};
