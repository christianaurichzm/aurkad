// @ts-check
// Bank module, client entry. The bank panel opens when the player steps
// on a bank tile (the server sends bank:open). There is no action button:
// the bank is only reached at its place on the map.

const ui = engine.ui;
const panel = ui.panel({ title: "Bank" });

engine.onServerEvent("bank:open", () => {
  panel.show();
  engine.sendServerEvent("bank:request");
});

let bank = { items: [], maxCapacity: 50 };

function render() {
  const header = document.createElement("div");
  header.textContent = `Slots: ${bank.items.length}/${bank.maxCapacity}`;
  header.style.cssText = "font-size:11px;color:#aaa;margin-bottom:4px;";

  const list = document.createElement("div");
  list.style.cssText = "max-height:180px;overflow-y:auto;margin-bottom:8px;";

  if (bank.items.length === 0) {
    const empty = document.createElement("div");
    empty.textContent = "Empty";
    empty.style.cssText = "color:#888;font-size:12px;padding:4px 0;";
    list.appendChild(empty);
  } else {
    for (const entry of bank.items) {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;justify-content:space-between;align-items:center;" +
        "padding:3px 0;border-bottom:1px solid #2a2a2a;font-size:13px;";
      const label = document.createElement("span");
      label.textContent = `#${entry.item} ×${entry.quantity}`;
      const wBtn = ui.button("↓ Withdraw", () => {
        const qty = Number(qtyInput.value) || 1;
        engine.sendServerEvent("bank:withdraw", {
          itemId: entry.item,
          quantity: qty,
        });
      });
      wBtn.style.cssText += "font-size:11px;padding:3px 7px;";
      row.append(label, wBtn);
      list.appendChild(row);
    }
  }

  const qtyInput = ui.input("Qty");
  qtyInput.type = "number";
  qtyInput.min = "1";
  qtyInput.value = "1";
  qtyInput.style.width = "60px";

  const itemInput = ui.input("Item ID");
  itemInput.type = "number";
  itemInput.min = "1";
  itemInput.style.width = "80px";

  const depositBtn = ui.button("Deposit", () => {
    const itemId = Number(itemInput.value);
    const qty = Number(qtyInput.value) || 1;
    if (itemId > 0)
      engine.sendServerEvent("bank:deposit", { itemId, quantity: qty });
  });

  const controls = document.createElement("div");
  controls.style.cssText = "border-top:1px solid #333;padding-top:8px;";
  const controlRow = ui.row(itemInput, qtyInput, depositBtn);
  const controlLabel = document.createElement("div");
  controlLabel.textContent = "Deposit: Item ID, Qty";
  controlLabel.style.cssText = "font-size:11px;color:#aaa;margin-bottom:4px;";
  controls.append(controlLabel, controlRow);

  panel.setBody(header, list, controls);
}

engine.onServerEvent("bank:update", (data) => {
  if (data && Array.isArray(data.items)) bank = data;
  render();
});

render();
