import React, { useEffect, useState } from 'react';
import { Modal } from '../common/Modal';
import { onServerEvent, sendServerEvent } from '../../io/network/customEvents';

interface DialogData {
  id: number;
  text: string;
  choices: string[];
}

// Built-in dialog box. Listens on the `dialog:show` channel and sends the
// player's pick back on `dialog:choose`. Content and flow live in server
// scripts (see showDialog / on('npcInteract')).
export const DialogBox: React.FC = () => {
  const [dialog, setDialog] = useState<DialogData | null>(null);

  useEffect(() => {
    return onServerEvent('dialog:show', (payload) => {
      const d = payload as DialogData;
      if (d && typeof d.id === 'number') setDialog(d);
    });
  }, []);

  if (!dialog) return null;

  const choose = (index: number) => {
    sendServerEvent('dialog:choose', { id: dialog.id, index });
    setDialog(null);
  };

  const buttons = dialog.choices.length > 0 ? dialog.choices : ['Continue'];

  return (
    <Modal title="" width={420} onClose={() => choose(0)}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{dialog.text}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {buttons.map((label, i) => (
            <button key={i} onClick={() => choose(i)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
};
