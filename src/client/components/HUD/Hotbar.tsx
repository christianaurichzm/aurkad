import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import {
  getHotbarSlots,
  subscribeHotbar,
  type HotbarSlot,
} from '../../io/modules/moduleActions';
import { spellSheet } from '../../io/assets';
import { SpritePreview } from '../common/SpritePreview';
import { useT } from '../../i18n';

const countdown = (ms: number) => {
  const seconds = ms / 1000;
  return seconds >= 1 ? String(Math.ceil(seconds)) : seconds.toFixed(1);
};

// One tile of the spell sheet, or the name's initial with no picture or no
// sheet. Modules get it as engine.ui.SpellIcon.
export const SpellIcon = ({ icon, name }: { icon?: number; name: string }) =>
  icon !== undefined && spellSheet ? (
    <SpritePreview
      spriteId={icon}
      sheet={spellSheet}
      tileSize={32}
      size={32}
      style={{ border: 'none', background: 'none' }}
    />
  ) : (
    <span className="spell-monogram" aria-hidden="true">
      {name.charAt(0)}
    </span>
  );

// The slots modules put along the bottom of the world (engine.ui.hotbar).
// A click or tap uses one like its key, and the module decides the rest.
export const Hotbar = () => {
  const t = useT();
  const slots = useSyncExternalStore(subscribeHotbar, getHotbarSlots);
  const now = Date.now();
  const cooling = slots.some((slot) => (slot.readyAt ?? 0) > now);

  // Cooldowns run out between a module's updates, so the bar keeps its own
  // clock while one runs.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!cooling) return;
    const id = setInterval(() => tick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [cooling]);

  if (slots.length === 0) return null;
  return (
    <div className="hotbar" role="toolbar" aria-label={t('hotbar.label')}>
      {slots.map((slot) => (
        <Slot key={slot.id} slot={slot} now={now} />
      ))}
    </div>
  );
};

const Slot = ({ slot, now }: { slot: HotbarSlot; now: number }) => {
  const t = useT();
  const tipId = useId();
  const left = Math.max(0, (slot.readyAt ?? 0) - now);
  const state = left > 0 ? 'cooldown' : slot.noMana ? 'nomana' : 'ready';
  const status =
    state === 'cooldown'
      ? t('hotbar.cooldown', { seconds: countdown(left) })
      : t(state === 'nomana' ? 'hotbar.noMana' : 'hotbar.ready');
  // With no declared duration there is no share to draw, so the slot stays
  // fully covered until it is ready.
  const owed = slot.cooldownMs ? Math.min(1, left / slot.cooldownMs) : 1;

  return (
    <span className="hotbar-tip">
      <button
        type="button"
        className="hotbar-slot"
        data-state={state}
        data-friendly={slot.friendly || undefined}
        aria-label={slot.key ? `${slot.key} ${slot.name}` : slot.name}
        aria-describedby={tipId}
        aria-disabled={state !== 'ready'}
        onClick={slot.onUse}
      >
        <SpellIcon icon={slot.icon} name={slot.name} />
        {slot.key && (
          <span className="hotbar-key" aria-hidden="true">
            {slot.key}
          </span>
        )}
        {!!slot.cost && (
          <span className="hotbar-cost" aria-hidden="true">
            {slot.cost}
          </span>
        )}
        {(state === 'nomana' || slot.friendly) && (
          <span className="hotbar-mark" aria-hidden="true">
            {state === 'nomana' ? 'MP!' : '+'}
          </span>
        )}
        {state === 'cooldown' && (
          <span
            className="hotbar-cooldown"
            aria-hidden="true"
            style={{ '--cd': `${owed * 100}%` } as CSSProperties}
          >
            {countdown(left)}
          </span>
        )}
      </button>
      <span role="tooltip" id={tipId} className="hotbar-tooltip">
        <strong>{slot.name}</strong>
        {slot.description && <span>{slot.description}</span>}
        <span>
          {slot.cost
            ? `${t('hotbar.cost', { cost: slot.cost })} · ${status}`
            : status}
        </span>
        {slot.key && <span>{t('hotbar.hotkey', { key: slot.key })}</span>}
      </span>
    </span>
  );
};
