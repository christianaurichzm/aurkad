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
  balance: number;
  owned: number;
}

export const ShopRow: React.FC<ShopRowProps> = ({
  shopId,
  product,
  onBought,
  balance,
  owned,
}) => {
  const t = useT();
  const itemCanvas = useRef<HTMLCanvasElement>(null);
  const coinCanvas = useRef<HTMLCanvasElement>(null);
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const affordable = balance >= product.price;

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
    if (buying || !affordable) return;
    setBuying(true);
    setNotice('');
    setFailed(false);
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
      setNotice(t('shop.purchased', { item: product.item.name }));
      onBought?.();
    } catch (error) {
      setFailed(true);
      setNotice(httpError(error).message || t('shop.purchaseFailed'));
    } finally {
      setBuying(false);
    }
  };

  return (
    <div
      data-shop-item={product.item.id}
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
          <span style={{ fontSize: 14, lineHeight: 1.5 }}>
            {product.item.description}
          </span>
          <span style={{ fontSize: 13, color: colors.textMuted }}>
            {t('shop.owned', { count: owned })}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <canvas ref={coinCanvas} width={ITEM_SIZE} height={ITEM_SIZE} />
            <span>
              {product.price} × {product.currency.name}
            </span>
          </div>
          {notice && (
            <span
              role={failed ? 'alert' : 'status'}
              style={{
                color: failed ? colors.dangerText : colors.success,
                fontWeight: 600,
              }}
            >
              {failed ? notice : `✓ ${notice}`}
            </span>
          )}
        </div>
      </div>
      <button
        onClick={handleBuy}
        disabled={buying || !affordable}
        title={!affordable ? t('shop.insufficient') : undefined}
        style={{
          padding: '10px 14px',
          background: colors.primary,
          color: '#fff',
          border: 'none',
          borderRadius: radius.md,
          cursor: affordable ? 'pointer' : 'not-allowed',
          opacity: buying || !affordable ? 0.55 : 1,
        }}
      >
        {buying ? '…' : t(affordable ? 'shop.buy' : 'shop.insufficient')}
      </button>
    </div>
  );
};
