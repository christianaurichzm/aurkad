import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { ProductDetailed, Shop } from '../../../shared/types';
import { fetchShop } from '../../io/network';
import { ShopRow } from './ShopRow';

export const ShopModal: React.FC = () => {
  const [shopId, setShopId] = useState<string | null>(null);
  const [shop, setShop] = useState<Shop<ProductDetailed> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<string>;
      setShopId(custom.detail);
      setLoading(true);
      fetchShop(custom.detail).then((s) => {
        setShop(s);
        setLoading(false);
      });
    };
    window.addEventListener('open-shop', handler as any);
    return () => window.removeEventListener('open-shop', handler as any);
  }, []);

  const close = () => setShopId(null);

  if (!shopId) return null;

  return (
    <Modal title={shop?.name || 'Shop'} width={520} onClose={close}>
      {loading ? (
        <p>Loading...</p>
      ) : !shop ? (
        <p>Shop not found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {shop.products.map((prod) => (
            <ShopRow key={prod.item.id} shopId={shop.id} product={prod} />
          ))}
        </div>
      )}
    </Modal>
  );
};
