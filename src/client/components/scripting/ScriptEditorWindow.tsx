import React, { useEffect, useRef, useState } from 'react';
import { Access } from '../../../shared/types';
import { useGame } from '../../GameContext';
import { usePlayerForceUpdate } from '../../hooks/usePlayerForceUpdate';
import { Modal } from '../common/Modal';
import { useT } from '../../i18n';

// Lazy, since Monaco is most of the client bundle and only an operator who
// opens this window should download it.
const ScriptEditor = React.lazy(() =>
  import('./ScriptEditor').then((m) => ({ default: m.ScriptEditor })),
);

/**
 * The script editor in a window over the world, opened from the creator tools
 * (ADMIN), so a save shows its effect in the game behind it.
 */
export const ScriptEditorWindow: React.FC = () => {
  const t = useT();
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const access = livePlayer?.access ?? sessionPlayer?.access ?? Access.USER;
  const [visible, setVisible] = useState(false);
  const dirtyFile = useRef<string | null>(null);

  // Closing unmounts the editor and drops its buffers, so unsaved edits are
  // asked about first, whichever way the window is closed.
  const close = () => {
    const file = dirtyFile.current;
    if (file && !window.confirm(t('script.discard', { file }))) return;
    dirtyFile.current = null;
    setVisible(false);
  };

  useEffect(() => {
    const toggle = () => (visible ? close() : setVisible(true));
    window.addEventListener('toggleScriptEditor', toggle);
    return () => window.removeEventListener('toggleScriptEditor', toggle);
  });

  if (access < Access.ADMIN || !visible) return null;

  return (
    <Modal
      title={t('admin.scripts')}
      width={Math.min(1100, window.innerWidth - 48)}
      onClose={close}
    >
      <React.Suspense fallback={t('common.loading')}>
        <ScriptEditor
          height={Math.round(Math.min(620, window.innerHeight * 0.85 - 110))}
          onDirtyChange={(file) => {
            dirtyFile.current = file;
          }}
        />
      </React.Suspense>
    </Modal>
  );
};
