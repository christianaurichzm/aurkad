import React, { useEffect, useRef } from 'react';
import { ITEM_SIZE } from '../../../shared/constants';
import { renderItemIcon } from '../../graphics/render';

export const ItemIcon: React.FC<{ spriteId: number }> = ({ spriteId }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, ITEM_SIZE, ITEM_SIZE);
    renderItemIcon(ctx, spriteId, 0, 0, false);
  }, [spriteId]);

  return (
    <canvas
      ref={ref}
      width={ITEM_SIZE}
      height={ITEM_SIZE}
      style={{ display: 'block' }}
    />
  );
};
