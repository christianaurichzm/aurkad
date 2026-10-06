import React, { useEffect, useReducer, useState } from 'react';
import { Access } from '../../shared/types';
import { useGame } from '../GameContext';
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
import { Icon, type IconName } from './common/Icon';
import { useGameBrand } from './common/AuthLayout';

type PlayerAction = {
  id: string;
  label: TranslationKey;
  // A hotkey has to be a member of the shared `Key` enum, which the server
  // validates on the wire.
  keyLabel: string;
  eventName: string;
  icon: IconName;
  order: number;
};

type CreatorAction = {
  id: string;
  label: TranslationKey;
  keyLabel: string;
  eventName: string;
  minAccess: Access;
  authorize: () => Promise<boolean>;
};

const playerActions: PlayerAction[] = [
  {
    id: 'inventory',
    label: 'actions.inventory',
    keyLabel: 'I',
    eventName: 'toggleInventory',
    icon: 'bag',
    order: 10,
  },
  {
    id: 'attributes',
    label: 'actions.attributes',
    keyLabel: 'V',
    eventName: 'toggleAttributeDistributor',
    icon: 'stats',
    order: 20,
  },
  {
    id: 'onlinePlayers',
    label: 'actions.onlinePlayers',
    keyLabel: 'O',
    eventName: 'toggleOnlinePlayers',
    icon: 'players',
    order: 120,
  },
];

const creatorActions: CreatorAction[] = [
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

const UNORDERED = Number.MAX_SAFE_INTEGER;

const togglePanel = (eventName: string) => {
  window.dispatchEvent(new Event(eventName));
};

type Tile = {
  id: string;
  label: string;
  keyLabel?: string;
  icon?: IconName;
  order?: number;
  onClick: () => void;
};

// The key is named once, by aria-keyshortcuts, so the chip is hidden from the
// accessible name, which stays the panel's.
const KeyChip = ({ keyLabel }: { keyLabel: string }) => (
  <span className="action-key" aria-hidden="true">
    {keyLabel}
  </span>
);

/** The panels every player opens, the engine's and the modules', as tiles. */
export const ActionPanel: React.FC = () => {
  const t = useT();

  // Buttons contributed by client modules (engine.ui.actionButton).
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeModuleActions(forceUpdate), []);
  const game = useGameBrand();

  const tiles: Tile[] = [
    ...playerActions
      .filter((a) => a.id !== 'attributes' || game?.attributes !== false)
      .filter((a) => a.id !== 'inventory' || game?.inventory !== false)
      .map((action) => ({
        id: action.id,
        label: t(action.label),
        keyLabel: action.keyLabel,
        icon: action.icon,
        order: action.order,
        onClick: () => togglePanel(action.eventName),
      })),
    // A module label is its own English, translated by the module's table, so
    // it follows a language switch.
    ...getModuleActions().map((action) => ({
      id: action.id,
      label: moduleText(action.label),
      keyLabel: action.key?.toUpperCase(),
      icon: action.icon,
      order: action.order,
      onClick: action.onClick,
    })),
    // Ordered from the player's own panels, to what is done with others, to
    // the records (numbers in clientEngine.d.ts); unordered tiles go last.
  ].sort((a, b) => (a.order ?? UNORDERED) - (b.order ?? UNORDERED));

  return (
    <section id="actionPanel" className="panel" aria-label={t('actions.title')}>
      <div className="action-grid">
        {tiles.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className="action-button"
            onClick={tile.onClick}
            title={t('actions.open', { panel: tile.label })}
            aria-keyshortcuts={tile.keyLabel}
          >
            {tile.icon ? (
              <Icon name={tile.icon} />
            ) : (
              <span className="action-monogram" aria-hidden="true">
                {tile.label.charAt(0)}
              </span>
            )}
            <span className="action-label">{tile.label}</span>
            {tile.keyLabel && <KeyChip keyLabel={tile.keyLabel} />}
          </button>
        ))}
      </div>
    </section>
  );
};

/** The editors and the GM panel, folded away at the foot of the column. */
export const CreatorTools: React.FC = () => {
  const t = useT();
  const [loadingPanel, setLoadingPanel] = useState<string | null>(null);
  const { player: sessionPlayer } = useGame();
  const livePlayer = usePlayerForceUpdate(true);
  const showDialog = useUIStore((state) => state.showDialog);
  const access = livePlayer?.access ?? sessionPlayer?.access ?? Access.USER;
  if (access < Access.MOD) return null;

  const openAction = async (action: CreatorAction) => {
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

  return (
    <details className="creator-tools">
      <summary>{t('actions.tools')}</summary>
      <div className="creator-tools-body">
        {creatorActions
          .filter((action) => access >= action.minAccess)
          .map((action) => (
            <button
              key={action.id}
              type="button"
              className="action-button"
              disabled={loadingPanel === action.id}
              onClick={() => void openAction(action)}
              title={t('actions.open', { panel: t(action.label) })}
              aria-keyshortcuts={action.keyLabel}
            >
              <KeyChip keyLabel={action.keyLabel} />
              <span>
                {loadingPanel === action.id
                  ? t('actions.opening')
                  : t(action.label)}
              </span>
            </button>
          ))}
      </div>
    </details>
  );
};
