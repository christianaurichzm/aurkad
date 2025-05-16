import {
  fetchItems,
  fetchNpcs,
  createItem,
  updateItem,
  deleteItem,
  createNpc,
  updateNpc,
  deleteNpc,
} from '../io/network';
import { setupAsyncSelect } from '../ui/asyncSelect';
import { SPRITE_HEIGHT, SPRITE_WIDTH } from '../../shared/constants';
import { drawSpriteGeneric } from './render';
import { Npc, Item, NpcBehavior } from '../../shared/types';
import { displayChatMessage } from '../ui/chat';
import { drawItemGeneric, renderItemIcon } from './inventory';

let isContentEditorOpen = false;

export function toggleContentEditorMenu() {
  const container = document.getElementById('contentEditorContainer');
  if (!container) return;

  if (container.style.display === 'flex') {
    container.style.display = 'none';
    isContentEditorOpen = false;
  } else {
    container.style.display = 'flex';
    isContentEditorOpen = true;
  }
}

export function closeContentEditorMenu() {
  const container = document.getElementById('contentEditorContainer');
  if (container) {
    container.style.display = 'none';
    isContentEditorOpen = false;
  }
}

setupAsyncSelect('itemSelect', 'Select an item', fetchItems, (item) => ({
  value: String(item.id),
  label: `${item.id} - ${item.name}`,
}));

setupAsyncSelect('npcSelect', 'Select an NPC', fetchNpcs, (npc) => ({
  value: String(npc.id),
  label: `${npc.id} - ${npc.name}`,
}));

function ensureSpritePreviewCanvas(id: string): HTMLCanvasElement {
  let canvas = document.getElementById(id) as HTMLCanvasElement;
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = id;
    canvas.width = SPRITE_WIDTH;
    canvas.height = SPRITE_HEIGHT;
    canvas.className = 'editor-preview-canvas';
    const parentDiv = document.querySelector(
      `#${id.replace('Preview', 'EditorFields')} > div`,
    );
    if (parentDiv) {
      parentDiv.innerHTML = '';
      parentDiv.appendChild(canvas);
    }
  }
  return canvas;
}

function renderSpritePreview(spriteId: number, canvasId: string) {
  const canvas = ensureSpritePreviewCanvas(canvasId);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSpriteGeneric(ctx, spriteId, 0, 0, 0, 0, canvas.width, canvas.height);
}

function renderItemPreview(spriteId: number, canvasId: string) {
  const canvas = ensureSpritePreviewCanvas(canvasId);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawItemGeneric(ctx, spriteId, 0, 0, canvas.width, canvas.height);
}

document.getElementById('editNpcBtn')?.addEventListener('click', () => {
  const select = document.getElementById('npcSelect') as HTMLSelectElement;
  const npcId = select.value;
  if (!npcId) return;

  fetchNpcs().then((npcs) => {
    const npc = npcs.find((n) => String(n.id) === npcId);
    if (!npc) return;
    (document.getElementById('npcNameInput') as HTMLInputElement).value =
      npc.name;
    (document.getElementById('npcSpriteInput') as HTMLInputElement).value =
      String(npc.sprite);
    (document.getElementById('npcHealthInput') as HTMLInputElement).value =
      String(npc.maxHealth ?? 1);
    (document.getElementById('npcAttackInput') as HTMLInputElement).value =
      String(npc.attack ?? 1);
    (document.getElementById('npcBehaviorInput') as HTMLSelectElement).value =
      (npc.behavior as string) ?? '';
    (document.getElementById('npcExpInput') as HTMLInputElement).value = String(
      npc.experienceValue ?? 0,
    );

    document.getElementById('npcEditorFields')!.style.display = 'flex';
    renderSpritePreview(Number(npc.sprite), 'npcSpritePreview');
  });
});

document.getElementById('createNpcBtn')?.addEventListener('click', () => {
  (document.getElementById('npcNameInput') as HTMLInputElement).value = '';
  (document.getElementById('npcSpriteInput') as HTMLInputElement).value = '';
  (document.getElementById('npcHealthInput') as HTMLInputElement).value = '1';
  (document.getElementById('npcAttackInput') as HTMLInputElement).value = '1';
  (document.getElementById('npcBehaviorInput') as HTMLSelectElement).value = '';
  (document.getElementById('npcExpInput') as HTMLInputElement).value = '0';
  document.getElementById('npcEditorFields')!.style.display = 'flex';
  renderSpritePreview(0, 'npcSpritePreview');
});

document.getElementById('npcSpriteInput')?.addEventListener('input', (e) => {
  const spriteId = Number((e.target as HTMLInputElement).value);
  if (!isNaN(spriteId)) renderSpritePreview(spriteId, 'npcSpritePreview');
});

document.getElementById('saveNpcBtn')?.addEventListener('click', async () => {
  const select = document.getElementById('npcSelect') as HTMLSelectElement;
  const id = select.value;
  const name = (document.getElementById('npcNameInput') as HTMLInputElement)
    .value;
  const sprite = Number(
    (document.getElementById('npcSpriteInput') as HTMLInputElement).value,
  );
  const maxHealth = Number(
    (document.getElementById('npcHealthInput') as HTMLInputElement).value,
  );
  const attack = Number(
    (document.getElementById('npcAttackInput') as HTMLInputElement).value,
  );
  const behavior = (
    document.getElementById('npcBehaviorInput') as HTMLSelectElement
  ).value as NpcBehavior;
  const experienceValue = Number(
    (document.getElementById('npcExpInput') as HTMLInputElement).value,
  );

  let result: Npc | null;
  if (id) {
    result = await updateNpc(id, {
      name,
      sprite,
      maxHealth,
      attack,
      behavior,
      experienceValue,
    });
  } else {
    result = await createNpc({
      name,
      sprite,
      maxHealth,
      attack,
      behavior,
      experienceValue,
    });
  }
  if (result) {
    displayChatMessage({
      scope: 'player',
      message: 'NPC salvo com sucesso!',
      type: 'chat',
    });
  } else {
    displayChatMessage({
      scope: 'player',
      message: 'Erro ao salvar NPC.',
      type: 'chat',
    });
  }
  document.getElementById('npcEditorFields')!.style.display = 'none';
});

document.getElementById('deleteNpcBtn')?.addEventListener('click', async () => {
  const id = (document.getElementById('npcSelect') as HTMLSelectElement).value;
  if (!id) return;
  await deleteNpc(id);
  displayChatMessage({
    scope: 'player',
    message: `NPC ${id} deletado.`,
    type: 'chat',
  });
});

document.getElementById('createItemBtn')?.addEventListener('click', () => {
  (document.getElementById('itemNameInput') as HTMLInputElement).value = '';
  (document.getElementById('itemSpriteInput') as HTMLInputElement).value = '';
  (document.getElementById('itemDescriptionInput') as HTMLInputElement).value =
    '';
  (document.getElementById('itemTypeInput') as HTMLSelectElement).value = '';
  document.getElementById('itemEditorFields')!.style.display = 'flex';
  renderItemPreview(0, 'itemSpritePreview');
});

document.getElementById('itemSpriteInput')?.addEventListener('input', (e) => {
  const spriteId = Number((e.target as HTMLInputElement).value);
  if (!isNaN(spriteId)) renderItemPreview(spriteId, 'itemSpritePreview');
});

document.getElementById('editItemBtn')?.addEventListener('click', () => {
  const select = document.getElementById(
    'itemSelect',
  ) as HTMLSelectElement | null;
  const itemId = select?.value;
  if (!itemId) return;

  fetchItems().then((items) => {
    const item = items.find((i) => String(i.id) === itemId);
    if (!item) return;

    const nameInput = document.getElementById(
      'itemNameInput',
    ) as HTMLInputElement | null;
    const spriteInput = document.getElementById(
      'itemSpriteInput',
    ) as HTMLInputElement | null;
    const descriptionInput = document.getElementById(
      'itemDescriptionInput',
    ) as HTMLInputElement | null;
    const typeInput = document.getElementById(
      'itemTypeInput',
    ) as HTMLSelectElement | null;

    if (nameInput) nameInput.value = item.name;
    if (spriteInput) spriteInput.value = String(item.sprite);
    if (descriptionInput) descriptionInput.value = item.description || '';
    if (typeInput) typeInput.value = item.type || '';

    document.getElementById('itemEditorFields')!.style.display = 'flex';
    renderItemPreview(Number(item.sprite), 'itemSpritePreview');
  });
});

document.getElementById('saveItemBtn')?.addEventListener('click', async () => {
  const select = document.getElementById(
    'itemSelect',
  ) as HTMLSelectElement | null;
  const id = select?.value;

  const nameInput = document.getElementById(
    'itemNameInput',
  ) as HTMLInputElement | null;
  const spriteInput = document.getElementById(
    'itemSpriteInput',
  ) as HTMLInputElement | null;
  const descriptionInput = document.getElementById(
    'itemDescriptionInput',
  ) as HTMLInputElement | null;
  const typeInput = document.getElementById(
    'itemTypeInput',
  ) as HTMLSelectElement | null;

  if (!nameInput || !spriteInput || !descriptionInput || !typeInput) return;

  const name = nameInput.value;
  const sprite = Number(spriteInput.value);
  const description = descriptionInput.value;
  const type = typeInput.value as Item['type'];

  let result: Item | null;
  if (id) {
    result = await updateItem(Number(id), { name, sprite, description, type });
  } else {
    result = await createItem({ name, sprite, description, type });
  }
  if (result) {
    displayChatMessage({
      scope: 'player',
      message: 'Item salvo com sucesso!',
      type: 'chat',
    });
  } else {
    displayChatMessage({
      scope: 'player',
      message: 'Erro ao salvar item.',
      type: 'chat',
    });
  }
  document.getElementById('itemEditorFields')!.style.display = 'none';
});

document
  .getElementById('deleteItemBtn')
  ?.addEventListener('click', async () => {
    const id = (document.getElementById('itemSelect') as HTMLSelectElement)
      .value;
    if (!id) return;
    await deleteItem(Number(id));
    displayChatMessage({
      scope: 'player',
      message: `Item ${id} deletado.`,
      type: 'chat',
    });
  });
