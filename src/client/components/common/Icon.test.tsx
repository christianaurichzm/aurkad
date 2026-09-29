import fs from 'node:fs';
import path from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon, ICON_NAMES } from './Icon';

const css = fs.readFileSync(
  path.resolve(__dirname, '../../../../public/styles.css'),
  'utf-8',
);

describe('Icon', () => {
  // A name without its variable leaves the mask invalid, and the span paints
  // as a solid square of the text colour.
  it.each(ICON_NAMES)('has a default picture for %s', (name) => {
    expect(css).toMatch(new RegExp(`--icon-${name}:\\s*url\\(`));
  });

  it('points the mask at its own variable and hides from assistive tech', () => {
    const { container } = render(<Icon name="attack" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.className).toBe('icon icon-attack');
    expect(span.style.getPropertyValue('--icon')).toBe('var(--icon-attack)');
    expect(span.getAttribute('aria-hidden')).toBe('true');
  });
});
