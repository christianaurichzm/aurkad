import React, { useEffect, useReducer, useState } from 'react';
import { Access } from '../../shared/types';
import { useGame } from '../context/GameContext';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import { openContentEditor, openMapEditor, openModEditor } from '../io/network';
import {
  getModuleActions,
  subscribeModuleActions,
} from '../io/modules/moduleActions';
import { useUIStore } from '../stores/uiStore';

type QuickAction = {
  id: string;
  label: string;
  keyLabel: string;
  eventName: string;
  minAccess: Access;
  className?: string;
  authorize?: () => Promise<boolean>;
};

const quickActions: QuickAction[] = [
  {
    id: 'inventory',
    label: 'Inventory',
    keyLabel: 'I',
    eventName: 'toggleInventory',
    minAccess: Access.USER,
    className: 'action-button-primary',
  },
  {
    id: 'attributes',
    label: 'Attributes',
    keyLabel: 'V',
    eventName: 'toggleAttributeDistributor',
    minAccess: Access.USER,
    className: 'action-button-primary',
  },
  {
    id: 'onlinePlayers',
    label: 'Online players',
    keyLabel: 'O',
    eventName: 'toggleOnlinePlayers',
    minAccess: Access.USER,
    className: 'action-button-primary',
  },
  {
    id: 'map',
    label: 'Map editor',
    keyLabel: 'Z',
    eventName: 'toggleTilesetEditor',
    minAccess: Access.ADMIN,
    authorize: openMapEditor,
  },
  {
    id: 'content',
    label: 'Content',
    keyLabel: 'C',
    eventName: 'toggleContentEditor',
    minAccess: Access.ADMIN,
    authorize: openContentEditor,
  },
  {
    id: 'mod',
    label: 'Moderation',
    keyLabel: 'X',
    eventName: 'toggleModMenu',
    minAccess: Access.MOD,
    authorize: openModEditor,
  },
];

export const ActionPanel: React.FC = () => {
  const [loadingPanel, setLoadingPanel] = useState<string | null>(null);
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const showDialog = useUIStore((state) => state.showDialog);
  const access = livePlayer?.access ?? sessionPlayer?.access ?? Access.USER;
  const visibleActions = quickActions.filter(
    (action) => access >= action.minAccess,
  );

  // Buttons contributed by client modules (engine.ui.actionButton).
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeModuleActions(forceUpdate), []);
  const moduleActions = getModuleActions();

  const togglePanel = (eventName: string) => {
    window.dispatchEvent(new Event(eventName));
  };

  const openAction = async (action: QuickAction) => {
    if (!action.authorize) {
      togglePanel(action.eventName);
      return;
    }

    setLoadingPanel(action.id);
    try {
      if (await action.authorize()) {
        togglePanel(action.eventName);
      } else {
        await showDialog({
          title: 'Access denied',
          message: `You do not have permission to open ${action.label}.`,
          kind: 'error',
        });
      }
    } catch (error: any) {
      await showDialog({
        title: 'Panel unavailable',
        message: error?.message || `Could not open ${action.label}.`,
        kind: 'error',
      });
    } finally {
      setLoadingPanel(null);
    }
  };

  return (
    <section id="actionPanel" aria-label="Quick actions">
      <div className="panel-title">Actions</div>
      <div className="action-grid">
        {visibleActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={['action-button', action.className]
              .filter(Boolean)
              .join(' ')}
            disabled={loadingPanel === action.id}
            onClick={() => void openAction(action)}
            title={`Open ${action.label}`}
          >
            <span className="action-key">{action.keyLabel}</span>
            <span>
              {loadingPanel === action.id ? 'Opening...' : action.label}
            </span>
          </button>
        ))}
        {moduleActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="action-button action-button-primary"
            onClick={action.onClick}
            title={`Open ${action.label}`}
          >
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
};
