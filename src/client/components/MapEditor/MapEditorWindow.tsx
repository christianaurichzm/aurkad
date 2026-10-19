import React, { useEffect, useReducer, useRef, useState } from 'react';
import {
  toggleMapEditor,
  mapEditorInitialized,
  resetToOriginalMap,
} from '../../graphics/mapEditor';
import { useUIStore } from '../../stores/uiStore';
import { MapEditorTools } from './MapEditorTools';
import { PHONE, useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { colors, zIndex } from '../../theme';
import { Icon } from '../common/Icon';
import { useT } from '../../i18n';

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

export const MapEditorWindow: React.FC = () => {
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
        title: t('mapEditor.discardTitle'),
        message: t('mapEditor.discardMessage'),
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

  // The latest one, so the dialog it may open speaks the current language.
  const closeRef = useRef(handleClose);
  closeRef.current = handleClose;
  useEffect(() => {
    const onToggle = () => {
      if (visibleRef.current) {
        void closeRef.current();
      } else {
        setVisible(true);
      }
    };
    window.addEventListener('toggleMapEditor', onToggle);
    return () => window.removeEventListener('toggleMapEditor', onToggle);
  }, []);

  useEffect(() => {
    if (visible) {
      toggleMapEditor(true);
    } else if (mapEditorInitialized) {
      toggleMapEditor(false);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      id="tilesetContainer"
      className="editor-window"
      ref={ref}
      style={{
        top: pos.y,
        left: pos.x,
        zIndex: zIndex.editor,
        maxHeight: 'calc(100dvh - 96px)',
        ...(strip && { ...strip, maxHeight: 'none' }),
      }}
    >
      <div className="window-titlebar" onPointerDown={onPointerDown}>
        <h2>{t('mapEditor.title')}</h2>
        <button
          type="button"
          aria-label={t('common.close')}
          className="window-close"
          onClick={(e) => {
            e.stopPropagation();
            void handleClose();
          }}
        >
          <Icon name="close" />
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
        <MapEditorTools />
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
