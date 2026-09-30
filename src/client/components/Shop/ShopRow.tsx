import { useState } from 'react';
import type { Item, ProductDetailed } from '../../../shared/types';
import { updatePlayerInventory } from '../../core/gameState';
import { buyShopItem, httpError } from '../../io/network';
import { useUIStore } from '../../stores/uiStore';
import { ItemComparison, ItemIcon, itemEffects } from '../Inventory/ItemIcon';
import { useT } from '../../i18n';

interface ShopRowProps {
  shopId: string;
  product: ProductDetailed;
  onBought?: () => void;
  balance: number;
  owned: number;
  /** No slot left for this item: the bag is full and holds none of it. */
  bagFull?: boolean;
  /** What the player wears where this would go. */
  inPlace?: Pick<Item, 'name' | 'effects'>;
}

export const ShopRow: React.FC<ShopRowProps> = ({
  shopId,
  product,
  onBought,
  balance,
  owned,
  bagFull = false,
  inPlace,
}) => {
  const t = useT();
  const { item, currency, price } = product;
  const [buying, setBuying] = useState(false);
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  // The button says what is in the way instead of going grey without a word.
  const reason = bagFull
    ? t('shop.bagFull')
    : balance < price
      ? t('shop.need', { count: price - balance })
      : '';
  const effects = itemEffects(t, item);

  const handleBuy = async () => {
    if (buying || reason) return;
    setBuying(true);
    setNotice('');
    setFailed(false);
    try {
      const res = await buyShopItem(shopId, item.id);
      if (!res?.success) {
        throw new Error(res?.message || 'Error purchasing.');
      }

      if (res.inventory) {
        updatePlayerInventory(res.inventory);
      }

      const said = t('shop.purchased', { item: item.name });
      useUIStore
        .getState()
        .addChatMessage({ message: said, scope: 'player', type: 'chat' });
      setNotice(said);
      onBought?.();
    } catch (error) {
      setFailed(true);
      setNotice(httpError(error).message || t('shop.purchaseFailed'));
    } finally {
      setBuying(false);
    }
  };

  return (
    <li className="list-row shop-row" data-shop-item={item.id}>
      <div className="item-detail-head">
        <span className="item-slot">
          <ItemIcon spriteId={item.sprite} />
        </span>
        <div>
          <h3>{item.name}</h3>
          {item.description && (
            <p className="item-detail-type">{item.description}</p>
          )}
          {effects && <p className="item-detail-effect">{effects}</p>}
          {inPlace && <ItemComparison item={item} inPlace={inPlace} />}
          {/* The answer to a purchase shares the line that counts them: a
              line of its own would push every row below it down the list. */}
          <p className="item-detail-note">
            {t('shop.owned', { count: owned })}{' '}
            {notice && (
              <span
                role={failed ? 'alert' : 'status'}
                className="item-compare"
                data-change={failed ? 'down' : 'up'}
              >
                {failed ? notice : `✓ ${notice}`}
              </span>
            )}
          </p>
        </div>
      </div>
      <div className="shop-buy">
        <span className="stack-count">
          <ItemIcon spriteId={currency.sprite} size={24} />
          {price}
        </span>
        {/* aria-disabled, not disabled: the button keeps its place in the
            arrow and Tab order, so the reason on it can be reached and read. */}
        <button
          type="button"
          className="button-primary"
          aria-disabled={buying || !!reason}
          aria-label={[
            t('shop.buyFor', {
              item: item.name,
              count: price,
              currency: currency.name,
            }),
            reason,
          ]
            .filter(Boolean)
            .join('. ')}
          onClick={() => void handleBuy()}
        >
          {buying ? '…' : reason || t('shop.buy')}
        </button>
      </div>
    </li>
  );
};
