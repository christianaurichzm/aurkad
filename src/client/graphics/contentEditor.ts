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
import { chatResultMsg } from '../ui/chat';
import { drawItemGeneric } from './inventory';
import {
  getEl,
  setInputValue,
  getInputValue,
  show,
  hide,
  addEvent,
  safeParseInt,
  batchSetInputs,
} from '../../server/domHelpers';

let isContentEditorOpen = false;

export function toggleContentEditorMenu() {
  const container = getEl('contentEditorContainer');
  if (!container) return;
  isContentEditorOpen = container.style.display !== 'flex';
  container.style.display = isContentEditorOpen ? 'flex' : 'none';
}
export function closeContentEditorMenu() {
  hide('contentEditorContainer');
  isContentEditorOpen = false;
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
  let canvas = getEl<HTMLCanvasElement>(id);
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

function showNpcFields() {
  show('npcEditorFields');
}
function hideNpcFields() {
  hide('npcEditorFields');
}
function clearNpcFields() {
  batchSetInputs({
    npcNameInput: '',
    npcSpriteInput: '',
    npcHealthInput: 1,
    npcAttackInput: 1,
    npcBehaviorInput: '',
    npcExpInput: 0,
  });
}

addEvent('editNpcBtn', 'click', async () => {
  const npcId = getInputValue('npcSelect');
  if (!npcId) return;
  const npcs = await fetchNpcs();
  const npc = npcs.find((n) => String(n.id) === npcId);
  if (!npc) return;
  batchSetInputs({
    npcNameInput: npc.name,
    npcSpriteInput: npc.sprite,
    npcHealthInput: npc.maxHealth ?? 1,
    npcAttackInput: npc.attack ?? 1,
    npcBehaviorInput: npc.behavior ?? '',
    npcExpInput: npc.experienceValue ?? 0,
  });
  showNpcFields();
  renderSpritePreview(Number(npc.sprite), 'npcSpritePreview');
});

addEvent('createNpcBtn', 'click', () => {
  clearNpcFields();
  showNpcFields();
  renderSpritePreview(0, 'npcSpritePreview');
});
addEvent('npcSpriteInput', 'input', (e) => {
  const spriteId = safeParseInt((e.target as HTMLInputElement).value, 0);
  renderSpritePreview(spriteId, 'npcSpritePreview');
});
addEvent('saveNpcBtn', 'click', async () => {
  const id = getInputValue('npcSelect');
  const name = getInputValue('npcNameInput');
  const sprite = safeParseInt(getInputValue('npcSpriteInput'), 0);
  const maxHealth = safeParseInt(getInputValue('npcHealthInput'), 1);
  const attack = safeParseInt(getInputValue('npcAttackInput'), 1);
  const behavior = getInputValue('npcBehaviorInput') as NpcBehavior;
  const experienceValue = safeParseInt(getInputValue('npcExpInput'), 0);

  const npcData = {
    name,
    sprite,
    maxHealth,
    attack,
    behavior,
    experienceValue,
  };
  const result = id ? await updateNpc(id, npcData) : await createNpc(npcData);

  chatResultMsg(!!result, 'NPC salvo com sucesso!', 'Erro ao salvar NPC.');
  hideNpcFields();
});
addEvent('deleteNpcBtn', 'click', async () => {
  const id = getInputValue('npcSelect');
  if (!id) return;
  try {
    await deleteNpc(id);
    chatResultMsg(true, `NPC ${id} deletado.`, '');
  } catch {
    chatResultMsg(false, '', 'Erro ao deletar NPC.');
  }
});

addEvent('createItemBtn', 'click', () => {
  batchSetInputs({
    itemNameInput: '',
    itemSpriteInput: '',
    itemDescriptionInput: '',
    itemTypeInput: '',
  });
  show('itemEditorFields');
  renderItemPreview(0, 'itemSpritePreview');
});
addEvent('itemSpriteInput', 'input', (e) => {
  const spriteId = safeParseInt((e.target as HTMLInputElement).value, 0);
  renderItemPreview(spriteId, 'itemSpritePreview');
});
addEvent('editItemBtn', 'click', async () => {
  const itemId = getInputValue('itemSelect');
  if (!itemId) return;
  const items = await fetchItems();
  const item = items.find((i) => String(i.id) === itemId);
  if (!item) return;
  batchSetInputs({
    itemNameInput: item.name,
    itemSpriteInput: item.sprite,
    itemDescriptionInput: item.description || '',
    itemTypeInput: item.type || '',
  });
  show('itemEditorFields');
  renderItemPreview(Number(item.sprite), 'itemSpritePreview');
});
addEvent('saveItemBtn', 'click', async () => {
  const id = getInputValue('itemSelect');
  const name = getInputValue('itemNameInput');
  const sprite = safeParseInt(getInputValue('itemSpriteInput'), 0);
  const description = getInputValue('itemDescriptionInput');
  const type = getInputValue('itemTypeInput') as Item['type'];

  const itemData = { name, sprite, description, type };
  const result = id
    ? await updateItem(Number(id), itemData)
    : await createItem(itemData);

  chatResultMsg(!!result, 'Item salvo com sucesso!', 'Erro ao salvar item.');
  hide('itemEditorFields');
});
addEvent('deleteItemBtn', 'click', async () => {
  const id = getInputValue('itemSelect');
  if (!id) return;
  try {
    await deleteItem(Number(id));
    chatResultMsg(true, `Item ${id} deletado.`, '');
  } catch {
    chatResultMsg(false, '', 'Erro ao deletar item.');
  }
});
