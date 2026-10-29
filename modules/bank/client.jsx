// @ts-check
// Bank module, client entry. The window opens when the player steps on a
// bank tile. A click moves a stack between the bank and the bag, and the
// server decides whether it may.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Bank: 'Banco',
    Bag: 'Bolsa',
    Vault: 'Cofre',
    'in the vault': 'no cofre',
    'in the bag': 'na bolsa',
    bound: 'vinculado',
    'Click an item to move it to the other side. A stack asks how many.':
      'Clique em um item para movê-lo para o outro lado. Uma pilha pergunta quantos.',
    'How many {item}': 'Quantos {item}',
    'Deposit {count}': 'Depositar {count}',
    'Withdraw {count}': 'Sacar {count}',
    Cancel: 'Cancelar',
  },
  es: {
    Bank: 'Banco',
    Bag: 'Bolsa',
    Vault: 'Cámara',
    'in the vault': 'en la cámara',
    'in the bag': 'en la bolsa',
    bound: 'vinculado',
    'Click an item to move it to the other side. A stack asks how many.':
      'Pulsa un objeto para pasarlo al otro lado. Una pila pregunta cuántos.',
    'How many {item}': 'Cuántos {item}',
    'Deposit {count}': 'Depositar {count}',
    'Withdraw {count}': 'Retirar {count}',
    Cancel: 'Cancelar',
  },
});

const { useState } = React;
const ui = engine.ui;

// As many 64px slots as the window holds with a scrollbar beside them: a
// wide one, or the width of a phone held upright.
const columns = () => (window.innerWidth < 500 ? 5 : 7);

// The module's state lives here, outside React: the server changes it, and
// every change redraws.
let bank = { items: [], maxCapacity: 50 }; // items: [{ item: ItemData, quantity }]
let shown = false;
// What the server answered the last thing the window asked for.
let said = '';

function draw() {
  engine.render(shown && <BankWindow />);
}

function hide() {
  shown = false;
  draw();
}

function send(channel, payload) {
  said = '';
  engine.sendServerEvent(channel, payload);
}

function BankWindow() {
  const t = engine.useT();
  const bag = engine.usePlayer()?.inventory ?? [];
  // The stack being split: { from: 'bank' | 'bag', id, quantity }.
  const [split, setSplit] = useState(null);
  const sides = { bank: bank.items, bag };
  // A stack that left its side since it was picked is no longer being split.
  const stack = split && sides[split.from].find((e) => e.item.id === split.id);
  // The stack may have shrunk under the amount that was chosen.
  const count = stack && Math.min(split.quantity, stack.quantity);

  const move = (from, itemId, quantity) => {
    setSplit(null);
    send(from === 'bag' ? 'bank:deposit' : 'bank:withdraw', {
      itemId,
      quantity,
    });
  };
  const pick = (from, { item, quantity }) => {
    // A single item needs no amount, and a bound one goes as is so the server
    // can say why it stays.
    if (quantity === 1 || (from === 'bag' && item.bound))
      move(from, item.id, 1);
    else setSplit({ from, id: item.id, quantity });
  };

  return (
    <ui.Window
      title={t('Bank')}
      width="wide"
      onClose={hide}
      footer={
        stack ? (
          <div className="window-actions" style={{ alignItems: 'center' }}>
            <ui.ItemIcon spriteId={stack.item.sprite} size={32} />
            <b style={{ flex: 1, minWidth: 0 }}>{stack.item.name}</b>
            <ui.Stepper
              value={count}
              max={stack.quantity}
              onChange={(quantity) => setSplit({ ...split, quantity })}
              label={t('How many {item}', { item: stack.item.name })}
            />
            <button
              type="button"
              className="button-primary"
              style={{ flex: 'none' }}
              onClick={() => move(split.from, split.id, count)}
            >
              {t(
                split.from === 'bag' ? 'Deposit {count}' : 'Withdraw {count}',
                { count },
              )}
            </button>
            <button type="button" onClick={() => setSplit(null)}>
              {t('Cancel')}
            </button>
          </div>
        ) : (
          <p className="window-label" role={said ? 'status' : undefined}>
            {said ||
              t(
                'Click an item to move it to the other side. A stack asks how many.',
              )}
          </p>
        )
      }
    >
      <Side
        title={t('Vault')}
        note={t('in the vault')}
        stacks={bank.items}
        capacity={bank.maxCapacity}
        picked={split?.from === 'bank' && split.id}
        onPick={(entry) => pick('bank', entry)}
      />
      <Side
        title={t('Bag')}
        note={t('in the bag')}
        stacks={bag}
        capacity={engine.getPlayer()?.inventoryCapacity ?? bag.length}
        picked={split?.from === 'bag' && split.id}
        onPick={(entry) => pick('bag', entry)}
      />
    </ui.Window>
  );
}

function Side({ title, note, stacks, capacity, picked, onPick }) {
  const t = engine.useT();
  // The held stacks plus the free slots finishing the last row, at least two
  // rows, rather than fifty empty slots.
  const across = columns();
  const slots = Math.min(
    capacity,
    Math.max(across * 2, Math.ceil((stacks.length + 1) / across) * across),
  );
  return (
    <section style={{ display: 'grid', gap: 6, margin: '0 auto' }}>
      <h3
        className="window-heading"
        style={{ display: 'flex', justifyContent: 'space-between' }}
      >
        {title}
        <span className="window-label">
          {stacks.length}/{capacity}
        </span>
      </h3>
      <div
        className="bag-grid"
        style={{ gridTemplateColumns: `repeat(${across}, 64px)` }}
      >
        {stacks.map((entry) => (
          <ui.ItemSlot
            key={entry.item.id}
            item={entry.item}
            quantity={entry.quantity}
            selected={picked === entry.item.id}
            note={entry.item.bound ? `${note}, ${t('bound')}` : note}
            onSelect={() => onPick(entry)}
          />
        ))}
        {Array.from({ length: Math.max(0, slots - stacks.length) }, (_, i) => (
          <span key={`free-${i}`} className="item-slot" data-empty />
        ))}
      </div>
    </section>
  );
}

engine.onServerEvent('bank:open', () => {
  shown = true;
  said = '';
  draw();
  engine.sendServerEvent('bank:request');
});

engine.onServerEvent('bank:update', (data) => {
  if (data && Array.isArray(data.items)) bank = data;
  draw();
});

engine.onServerEvent('bank:result', (result) => {
  said = String(result?.message ?? '');
  draw();
});
