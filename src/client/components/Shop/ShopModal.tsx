import React, { useState, useEffect } from 'react';
import { Modal } from '../common/Modal';
import { ProductDetailed, Shop } from '../../../shared/types';
import { fetchShop } from '../../io/network';
import { ShopRow } from './ShopRow';
import { useT } from '../../i18n';

export const ShopModal: React.FC = () => {
  const t = useT();
  const [shopId, setShopId] = useState<string | null>(null);
  const [shop, setShop] = useState<Shop<ProductDetailed> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent<string>;
      setShopId(custom.detail);
      setLoading(true);
      // Without the catch a failed fetch leaves the modal on "Loading..."
      // for as long as it stays open.
      fetchShop(custom.detail)
        .then(setShop)
        .catch(() => setShop(null))
        .finally(() => setLoading(false));
    };
    window.addEventListener('open-shop', handler);
    return () => window.removeEventListener('open-shop', handler);
  }, []);

  const close = () => setShopId(null);

  if (!shopId) return null;

  return (
    <Modal title={shop?.name || 'Shop'} width={520} onClose={close}>
      {loading ? (
        <p>{t('common.loading')}</p>
      ) : !shop ? (
        <p>{t('shop.notFound')}</p>
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
