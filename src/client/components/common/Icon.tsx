import type { CSSProperties } from 'react';

export const ICON_NAMES = [
  'up',
  'down',
  'left',
  'right',
  'attack',
  'interact',
  'pickup',
  'run',
  'settings',
  'menu',
  'close',
] as const;
export type IconName = (typeof ICON_NAMES)[number];

// The picture is --icon-<name>, painted by .icon in styles.css, so a theme
// can replace it. The union keeps unknown names out.
export const Icon = ({ name }: { name: IconName }) => (
  <span
    aria-hidden="true"
    className={`icon icon-${name}`}
    style={{ '--icon': `var(--icon-${name})` } as CSSProperties}
  />
);
