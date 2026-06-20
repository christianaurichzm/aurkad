import React, { useEffect, useRef, useState } from 'react';
import {
  toggleTilesetEditor,
  tilesetEditorInitialized,
  resetToOriginalMap,
} from '../../graphics/tileset';
import { useUIStore } from '../../stores/uiStore';
import { TilesetModeControls } from './TilesetModeControls';
import { useDraggable } from '../../hooks/useDraggable';
import { zIndex } from '../../theme';

export const TilesetEditor: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const visibleRef = useRef(false);

  const { ref, pos, onMouseDown } = useDraggable(100, 100);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  const handleClose = async () => {
    const { mapEdited, setMapEdited } = useUIStore.getState();
    if (mapEdited) {
      const discard = await useUIStore.getState().showDialog({
        title: 'Discard map changes?',
        message: 'You have unsaved changes. Discard them?',
        kind: 'confirm',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep editing',
      });
      if (!discard) return;
      resetToOriginalMap();
      setMapEdited(false);
    }
    setVisible(false);
  };

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

  return (
    <>
      {visible && (
        <div
          id="tilesetContainer"
          ref={ref}
          onMouseDown={onMouseDown}
          style={{
            position: 'fixed',
            top: pos.y,
            left: pos.x,
            zIndex: zIndex.editor,
          }}
        >
          <button
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              border: 'none',
              background: 'transparent',
              fontSize: '1.2rem',
              cursor: 'pointer',
              color: 'inherit',
            }}
            onClick={(e) => {
              e.stopPropagation();
              void handleClose();
            }}
          >
            X
          </button>
          <TilesetModeControls />
          <canvas id="tilesetCanvas" />
        </div>
      )}
    </>
  );
};
