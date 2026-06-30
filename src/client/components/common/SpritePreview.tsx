import React, { useEffect, useRef } from 'react';
import { drawSpriteGeneric } from '../../graphics/render';
import { colors, radius } from '../../theme';
import { TILE_SIZE } from '../../../shared/constants';

interface SpritePreviewProps {
  spriteId: number;
  size?: number;
  style?: React.CSSProperties;
  sheet?: HTMLCanvasElement;
  tileSize?: number;
}

export const SpritePreview: React.FC<SpritePreviewProps> = ({
  spriteId,
  size = 64,
  style,
  sheet,
  tileSize,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    if (sheet) {
      const ts = tileSize ?? TILE_SIZE;
      const tilesPerRow = Math.max(1, Math.floor(sheet.width / ts));
      const sx = (spriteId % tilesPerRow) * ts;
      const sy = Math.floor(spriteId / tilesPerRow) * ts;
      ctx.drawImage(sheet, sx, sy, ts, ts, 0, 0, size, size);
    } else if (tileSize === undefined) {
      drawSpriteGeneric(ctx, spriteId, 0, 0, 0, 0, size, size);
    }
  }, [spriteId, size, sheet, tileSize]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: radius.sm,
        background: colors.surfaceMuted,
        flexShrink: 0,
        ...style,
      }}
    />
  );
};
