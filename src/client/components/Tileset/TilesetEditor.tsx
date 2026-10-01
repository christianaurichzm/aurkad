import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  toggleTilesetEditor,
  tilesetEditorInitialized,
  resetToOriginalMap,
} from '../../graphics/tileset';
import { useUIStore } from '../../stores/uiStore';
import { TilesetModeControls } from './TilesetModeControls';
import { useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { colors, radius, shadow, zIndex } from '../../theme';
import { useT } from '../../i18n';

// Where useDraggable stops dragging: a phone, upright or on its side.
const PHONE = '(max-width: 700px), (pointer: coarse) and (max-height: 600px)';
const MARGIN = 8;
const NARROWEST = 160;

/**
 * The largest strip of screen the world leaves free, under or beside it, or
 * null when none fits the palette. An undraggable panel sits there so the
 * map stays in sight.
 */
export const freeOfTheWorld = (world: DOMRect, width: number, height: number) =>
  [
    {
      top: world.bottom + MARGIN,
      left: MARGIN,
      width: width - 2 * MARGIN,
      height: height - world.bottom - 2 * MARGIN,
    },
    {
      top: MARGIN,
      left: world.right + MARGIN,
      width: width - world.right - 2 * MARGIN,
      height: height - 2 * MARGIN,
    },
    {
      top: MARGIN,
      left: MARGIN,
      width: world.left - 2 * MARGIN,
      height: height - 2 * MARGIN,
    },
  ]
    .filter((strip) => Math.min(strip.width, strip.height) >= NARROWEST)
    .sort((a, b) => b.width * b.height - a.width * a.height)[0] ?? null;

export const TilesetEditor: React.FC = () => {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  const { ref, pos, onPointerDown } = useDraggable(100, 80);
  const phone = useMediaQuery(PHONE);
  // Turning the phone moves the world, and the strip it leaves with it.
  const [, relayout] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener('resize', relayout);
    return () => window.removeEventListener('resize', relayout);
  }, []);
  const world = document.getElementById('canvasFrame');
  const strip =
    phone && world
      ? freeOfTheWorld(
          world.getBoundingClientRect(),
          window.innerWidth,
          window.innerHeight,
        )
      : null;

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const handleClose = async () => {
    const { mapEdited, setMapEdited } = useUIStore.getState();
    if (mapEdited) {
      const discard = await useUIStore.getState().showDialog({
        title: t('tileset.discardTitle'),
        message: t('tileset.discardMessage'),
        kind: 'confirm',
        confirmLabel: t('editor.discard'),
        cancelLabel: t('editor.keepEditing'),
      });
      if (!discard) return;
      resetToOriginalMap();
      setMapEdited(false);
    }
    setVisible(false);
  };

  useEscapeClose(visible, handleClose);

  useEffect(() => {
    const onToggle = () => {
      if (visibleRef.current) {
        void handleClose();
      } else {
        setVisible(true);
      }
    };
    window.addEventListener('toggleTilesetEditor', onToggle);
    return () => window.removeEventListener('toggleTilesetEditor', onToggle);
  }, []); // stable: handleClose reads store/ref directly

  useEffect(() => {
    if (visible) {
      toggleTilesetEditor(true);
    } else if (tilesetEditorInitialized) {
      toggleTilesetEditor(false);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      id="tilesetContainer"
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: zIndex.editor,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.panel,
        boxShadow: shadow.modal,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: 'calc(100dvh - 96px)',
        ...(strip && { ...strip, maxHeight: 'none' }),
      }}
    >
      <div
        onPointerDown={onPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: `1px solid ${colors.border}`,
          background: colors.surfaceMuted,
          cursor: 'move',
          userSelect: 'none',
          touchAction: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 13, color: colors.text }}>
          {t('tileset.title')}
        </span>
        <button
          aria-label={t('common.close')}
          className="window-close"
          style={{
            border: 'none',
            background: 'transparent',
            fontSize: 16,
            cursor: 'pointer',
            color: colors.textMuted,
            lineHeight: 1,
            padding: '0 2px',
          }}
          onClick={(e) => {
            e.stopPropagation();
            void handleClose();
          }}
        >
          ×
        </button>
      </div>

      <div
        style={{
          flexShrink: 0,
          borderBottom: `1px solid ${colors.border}`,
          // Docked on a phone the controls would take the whole strip and
          // push the palette out of it.
          ...(strip && { maxHeight: '45%', overflowY: 'auto' }),
        }}
      >
        <TilesetModeControls />
      </div>

      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        <canvas
          id="tilesetCanvas"
          style={{
            display: 'block',
            width: '100%',
            // The sheet is drawn color-keyed, so a checker under it is what
            // tells a transparent tile apart from a white one.
            background:
              'repeating-conic-gradient(#c9c9c9 0% 25%, #eeeeee 0% 50%) 0 0 / 16px 16px',
          }}
        />
      </div>
    </div>
  );
};
