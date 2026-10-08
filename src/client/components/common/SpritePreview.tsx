import React, { useEffect, useRef } from 'react';
import { drawSpriteGeneric } from '../../graphics/render';
import { entityAtlas } from '../../graphics/atlas';
import { characterLayout } from '../../graphics/sprite';
import { colors, radius } from '../../theme';
import { TILE_SIZE } from '../../../shared/constants';

interface SpritePreviewProps {
  spriteId: number;
  size?: number;
  style?: React.CSSProperties;
  sheet?: HTMLCanvasElement;
  tileSize?: number;
  /** Loops `spriteId .. spriteId + frames - 1` from `sheet`. */
  frames?: number;
  frameMs?: number;
}

/**
 * A character's sprite with no frame, for a box the stylesheet draws, where
 * a theme can swap it for a picture. `size` is the buffer.
 */
export const Sprite = ({
  spriteId,
  size,
}: Pick<SpritePreviewProps, 'spriteId' | 'size'>) => (
  <SpritePreview
    spriteId={spriteId}
    size={size}
    style={{
      display: 'block',
      width: '100%',
      height: '100%',
      border: 'none',
      borderRadius: 0,
      background: 'none',
    }}
  />
);

export const SpritePreview: React.FC<SpritePreviewProps> = ({
  spriteId,
  size = 64,
  style,
  sheet,
  tileSize,
  frames = 1,
  frameMs = 100,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const start = performance.now();
    const draw = () => {
      ctx.clearRect(0, 0, size, size);
      if (sheet) {
        const ts = tileSize ?? TILE_SIZE;
        const tilesPerRow = Math.max(1, Math.floor(sheet.width / ts));
        const id =
          spriteId +
          (Math.floor((performance.now() - start) / frameMs) %
            Math.max(1, frames));
        const sx = (id % tilesPerRow) * ts;
        const sy = Math.floor(id / tilesPerRow) * ts;
        ctx.drawImage(sheet, sx, sy, ts, ts, 0, 0, size, size);
        if (frames > 1) frame = requestAnimationFrame(draw);
        return;
      }
      // The figure's tile-sized box fills the preview, grown upwards to the
      // top of a frame taller than a tile so the head stays in. A frame wider
      // than that spills past the sides rather than shrinking the figure.
      const { width, height, anchorX, anchorY, scale } =
        characterLayout(spriteId);
      const k = (size / Math.max(TILE_SIZE, anchorY * scale)) * scale;
      drawSpriteGeneric(
        ctx,
        spriteId,
        0,
        0,
        size / 2 - anchorX * k,
        size - anchorY * k,
        width * k,
        height * k,
      );
      // The atlas may load after this mounts and nothing re-renders when it
      // does, so the draw retries until it is there.
      if (!entityAtlas) frame = requestAnimationFrame(draw);
    };
    draw();

    return () => cancelAnimationFrame(frame);
  }, [spriteId, size, sheet, tileSize, frames, frameMs]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: radius.control,
        background: colors.surfaceMuted,
        flexShrink: 0,
        ...style,
      }}
    />
  );
};
