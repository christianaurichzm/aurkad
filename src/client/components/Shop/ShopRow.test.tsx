import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ShopRow } from './ShopRow';
import { buyShopItem } from '../../io/network';
import { updatePlayerInventory } from '../../core/gameState';
import type { Item, ProductDetailed } from '../../../shared/types';

vi.mock('../../graphics/render', () => ({ renderItemIcon: vi.fn() }));
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
vi.mock('../../core/gameState', () => ({ updatePlayerInventory: vi.fn() }));
vi.mock('../../io/network', () => ({
  buyShopItem: vi.fn(),
  httpError: (e: Error) => e,
}));

const gold: Item = {
  id: 3,
  name: 'Gold',
  description: '',
  sprite: 0,
  type: 'money',
};
const potion: ProductDetailed = {
  item: {
    id: 1,
    name: 'Potion',
    description: 'Restores 50 health.',
    sprite: 0,
    type: 'consumable',
    effects: [{ attribute: 'health', type: 'add', value: 50 }],
  },
  currency: gold,
  price: 8,
};

it('says on the button why a thing cannot be bought, and does not buy it', () => {
  const { rerender } = render(
    <ShopRow shopId="shop" product={potion} balance={2} owned={1} />,
  );
  const short = screen.getByRole('button', {
    name: 'Buy Potion for 8 Gold. Need 6 more',
  });
  expect(short).toHaveTextContent('Need 6 more');
  // Still in the Tab order, so the reason can be reached.
  expect(short).toBeEnabled();
  expect(short).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(short);

  rerender(
    <ShopRow shopId="shop" product={potion} balance={40} owned={0} bagFull />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Bag is full$/ }));
  expect(buyShopItem).not.toHaveBeenCalled();
});

it('applies the confirmed inventory and answers a purchase in its own row', async () => {
  render(<ShopRow shopId="shop" product={potion} balance={40} owned={1} />);
  expect(screen.getByText('Owned: 1')).toBeVisible();
  expect(screen.getByText('Restores 50 health.')).toBeVisible();
  expect(screen.getByText('+50 Health')).toBeVisible();

  const buy = screen.getByRole('button', { name: 'Buy Potion for 8 Gold' });
  expect(buy).toHaveTextContent('Buy');
  vi.mocked(buyShopItem).mockResolvedValueOnce({
    success: true,
    inventory: [],
  });
  fireEvent.click(buy);
  expect(await screen.findByRole('status')).toHaveTextContent(
    'Potion purchased.',
  );
  expect(updatePlayerInventory).toHaveBeenCalledWith([]);

  vi.mocked(buyShopItem).mockRejectedValueOnce(new Error('Inventory full'));
  fireEvent.click(buy);
  expect(await screen.findByRole('alert')).toHaveTextContent('Inventory full');
});

it('compares gear with what is worn in its place', () => {
  const sword: ProductDetailed = {
    item: {
      id: 2,
      name: 'Iron Sword',
      description: 'A sturdy blade.',
      sprite: 0,
      type: 'weapon',
      effects: [{ attribute: 'attack', type: 'add', value: 5 }],
    },
    currency: gold,
    price: 30,
  };
  render(
    <ShopRow
      shopId="shop"
      product={sword}
      balance={40}
      owned={0}
      inPlace={{
        name: 'Hunting Bow',
        effects: [{ attribute: 'attack', type: 'add', value: 2 }],
      }}
    />,
  );
  expect(screen.getByText('+3 Attack vs Hunting Bow')).toHaveAttribute(
    'data-change',
    'up',
  );
});
