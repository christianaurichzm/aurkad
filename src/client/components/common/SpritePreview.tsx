import React, { useEffect, useRef } from 'react';
import { drawSpriteGeneric } from '../../graphics/render';
import { colors, radius } from '../../theme';

interface SpritePreviewProps {
  spriteId: number;
  size?: number;
  style?: React.CSSProperties;
}

export const SpritePreview: React.FC<SpritePreviewProps> = ({
  spriteId,
  size = 64,
  style,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    drawSpriteGeneric(ctx, spriteId, 0, 0, 0, 0, size, size);
  }, [spriteId, size]);

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
