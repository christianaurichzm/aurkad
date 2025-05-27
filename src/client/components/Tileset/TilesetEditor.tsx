import React, { useEffect, useState } from 'react';
import {
  toggleTilesetEditor,
  tilesetEditorInitialized,
} from '../../graphics/tileset';
import { TilesetModeControls } from './TilesetModeControls';
import { useDraggable } from '../../hooks/useDraggable';

export const TilesetEditor: React.FC = () => {
  const [visible, setVisible] = useState(false);

  const { ref, pos, onMouseDown } = useDraggable(100, 100);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleTilesetEditor', onToggle);
    return () => window.removeEventListener('toggleTilesetEditor', onToggle);
  }, []);

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
            zIndex: 500,
          }}
        >
          <button
            className="editor-btn"
            style={{
              position: 'absolute',
              top: 8,
              right: 8,
              border: 'none',
              background: 'transparent',
              fontSize: '1.2rem',
              cursor: 'pointer',
              color: 'black',
            }}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new Event('toggleTilesetEditor'));
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
