import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';
import React, { useState, useEffect, useReducer } from 'react';
import { Modal } from '../common/Modal';
import { ProductDetailed, Shop } from '../../../shared/types';
import { fetchShop } from '../../io/network';
import { ItemIcon, wornInPlaceOf } from '../Inventory/ItemIcon';
import { ShopRow } from './ShopRow';
import { useT } from '../../i18n';

// Up and down walk the buy buttons, one product to the next.
const walkRows = (e: React.KeyboardEvent<HTMLUListElement>) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const buttons = [...e.currentTarget.querySelectorAll('button')];
  const at = buttons.indexOf(e.target as HTMLButtonElement);
  const next = buttons[at + (e.key === 'ArrowDown' ? 1 : -1)];
  if (at < 0 || !next) return;
  e.preventDefault();
  next.focus();
};

export const ShopModal: React.FC = () => {
  const t = useT();
  const [shopId, setShopId] = useState<string | null>(null);
  const [shop, setShop] = useState<Shop<ProductDetailed> | null>(null);
  const [loading, setLoading] = useState(false);
  const player = usePlayerForceUpdate(!!shopId);
  // A purchase changes the balance and the counts; redrawn then rather than on
  // the next poll.
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const bag = player?.inventory ?? [];
  const count = (id: number) =>
    bag.reduce(
      (total, entry) => total + (entry.item.id === id ? entry.quantity : 0),
      0,
    );
  // One more of something already carried stacks on it; anything else needs a
  // slot of its own.
  const bagFull = !!player && bag.length >= player.inventoryCapacity;

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<string>;
      setShopId(custom.detail);
    };
    window.addEventListener('open-shop', handler);
    return () => window.removeEventListener('open-shop', handler);
  }, []);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    setLoading(true);
    setShop(null);
    fetchShop(shopId)
      .then((value) => {
        if (!cancelled) setShop(value);
      })
      .catch(() => {
        if (!cancelled) setShop(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  const close = () => {
    setShopId(null);
    setShop(null);
  };

  if (!shopId) return null;

  return (
    <Modal
      title={shop?.name || t('shop.title')}
      size="wide"
      floating
      onClose={close}
      footer={
        shop && (
          <p className="shop-wallet" aria-live="polite">
            {[
              ...new Map(
                shop.products.map((p) => [p.currency.id, p.currency]),
              ).values(),
            ].map((currency) => (
              <span key={currency.id}>
                <ItemIcon spriteId={currency.sprite} size={24} />
                <b className="stack-count">{count(currency.id)}</b>{' '}
                {currency.name}
              </span>
            ))}
            {player && (
              <span className="window-label">
                {t('inventory.bag')} {bag.length}/{player.inventoryCapacity}
              </span>
            )}
          </p>
        )
      }
    >
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : !shop ? (
        <p>{t('shop.notFound')}</p>
      ) : (
        <ul className="list" onKeyDown={walkRows}>
          {shop.products.map((prod) => (
            <ShopRow
              key={prod.item.id}
              shopId={shop.id}
              product={prod}
              balance={count(prod.currency.id)}
              owned={count(prod.item.id)}
              bagFull={bagFull && count(prod.item.id) === 0}
              inPlace={player ? wornInPlaceOf(player, prod.item) : undefined}
              onBought={refresh}
            />
          ))}
        </ul>
      )}
    </Modal>
  );
};
