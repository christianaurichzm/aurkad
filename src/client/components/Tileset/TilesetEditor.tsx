import React, { useEffect, useRef, useState } from 'react';
import {
  toggleTilesetEditor,
  tilesetEditorInitialized,
  resetToOriginalMap,
} from '../../graphics/tileset';
import { useUIStore } from '../../stores/uiStore';
import { TilesetModeControls } from './TilesetModeControls';
import { useDraggable } from '../../hooks/useDraggable';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { colors, radius, shadow, zIndex } from '../../theme';
import { useT } from '../../i18n';

export const TilesetEditor: React.FC = () => {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  const { ref, pos, onPointerDown } = useDraggable(100, 80);

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
        borderRadius: radius.lg,
        boxShadow: shadow.modal,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '95vh',
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
        style={{ flexShrink: 0, borderBottom: `1px solid ${colors.border}` }}
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
