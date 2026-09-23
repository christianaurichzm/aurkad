import React, { useEffect, useReducer, useState } from 'react';
import { Access } from '../../shared/types';
import { useGame } from '../context/GameContext';
import { usePlayerForceUpdate } from '../hooks/usePlayerForceUpdate';
import {
  httpError,
  openContentEditor,
  openMapEditor,
  openModEditor,
} from '../io/network';
import {
  getModuleActions,
  subscribeModuleActions,
} from '../io/modules/moduleActions';
import { useUIStore } from '../stores/uiStore';
import { moduleText, useT, type TranslationKey } from '../i18n';

type QuickAction = {
  id: string;
  label: TranslationKey;
  // Optional: a hotkey has to be a member of the shared `Key` enum, which the
  // server validates on the wire. Panels that are not worth that go without.
  keyLabel?: string;
  eventName: string;
  minAccess: Access;
  className?: string;
  authorize?: () => Promise<boolean>;
};

const quickActions: QuickAction[] = [
  {
    id: 'inventory',
    label: 'actions.inventory',
    keyLabel: 'I',
    eventName: 'toggleInventory',
    minAccess: Access.USER,
    className: 'action-button-primary',
  },
  {
    id: 'attributes',
    label: 'actions.attributes',
    keyLabel: 'V',
    eventName: 'toggleAttributeDistributor',
    minAccess: Access.USER,
    className: 'action-button-primary',
  },
  {
    id: 'onlinePlayers',
    label: 'actions.onlinePlayers',
    keyLabel: 'O',
    eventName: 'toggleOnlinePlayers',
    minAccess: Access.USER,
    className: 'action-button-primary',
  },
  {
    id: 'map',
    label: 'actions.mapEditor',
    keyLabel: 'Z',
    eventName: 'toggleTilesetEditor',
    minAccess: Access.ADMIN,
    authorize: openMapEditor,
  },
  {
    id: 'content',
    label: 'actions.content',
    keyLabel: 'C',
    eventName: 'toggleContentEditor',
    minAccess: Access.ADMIN,
    authorize: openContentEditor,
  },
  {
    id: 'gm',
    label: 'actions.gmPanel',
    keyLabel: 'X',
    eventName: 'toggleGMPanel',
    minAccess: Access.MOD,
    authorize: openModEditor,
  },
];

export const ActionPanel: React.FC = () => {
  const t = useT();
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
          title: t('actions.accessDenied'),
          message: t('actions.noPermission', { panel: t(action.label) }),
          kind: 'error',
        });
      }
    } catch (error) {
      await showDialog({
        title: t('actions.unavailable'),
        message:
          httpError(error).message ||
          t('actions.couldNotOpen', { panel: t(action.label) }),
        kind: 'error',
      });
    } finally {
      setLoadingPanel(null);
    }
  };

  const renderAction = (action: QuickAction) => (
    <button
      key={action.id}
      type="button"
      className={['action-button', action.className].filter(Boolean).join(' ')}
      disabled={loadingPanel === action.id}
      onClick={() => void openAction(action)}
      title={t('actions.open', { panel: t(action.label) })}
    >
      {action.keyLabel && <span className="action-key">{action.keyLabel}</span>}
      <span>
        {loadingPanel === action.id ? t('actions.opening') : t(action.label)}
      </span>
    </button>
  );

  return (
    <section id="actionPanel" aria-label={t('actions.title')}>
      <div className="panel-title">{t('actions.title')}</div>
      <div className="action-grid">
        {visibleActions
          .filter((action) => action.minAccess === Access.USER)
          .map(renderAction)}
        {/* A module label is its own English, translated by the table its
            module declared (engine.i18n), so it follows a switch like the
            built-ins above rather than staying in the language it registered. */}
        {moduleActions.length > 0 && (
          <div
            className="panel-title"
            style={{ gridColumn: '1 / -1', marginTop: 8 }}
          >
            {t('actions.modules')}
          </div>
        )}
        {moduleActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className="action-button action-button-primary"
            onClick={action.onClick}
            title={t('actions.open', { panel: moduleText(action.label) })}
          >
            {action.key && (
              <span className="action-key">{action.key.toUpperCase()}</span>
            )}
            <span>{moduleText(action.label)}</span>
          </button>
        ))}
      </div>
      {access >= Access.MOD && (
        <details className="creator-tools">
          <summary>{t('actions.tools')}</summary>
          <div className="action-grid">
            {visibleActions
              .filter((action) => action.minAccess > Access.USER)
              .map(renderAction)}
          </div>
        </details>
      )}
    </section>
  );
};
