import { Access } from '../../shared/types';
import { toggleTilesetEditor } from './tileset';
import {
  modKick,
  modBring,
  modGoto,
  modSetAccess,
  modSetSprite,
  modMoveMap,
  modSetMyAccess,
  changeSprite,
  modBan,
} from '../io/network';
import { chatResultMsg, displayChatMessage } from '../ui/chat';
import {
  getEl,
  getInputValue,
  addEvent,
  show,
  hide,
  safeParseInt,
} from '../../server/domHelpers';

let isModMenuOpen = false;

export function toggleModMenu() {
  const modContainer = getEl('modContainer');
  const tilesetContainer = getEl('tilesetContainer');
  if (!modContainer || !tilesetContainer) return;

  if (modContainer.style.display === 'flex') {
    hide('modContainer');
    isModMenuOpen = false;
  } else {
    if (tilesetContainer.style.display === 'flex') toggleTilesetEditor();
    show('modContainer', 'flex');
    isModMenuOpen = true;
  }
}
export function closeModMenu() {
  hide('modContainer');
  isModMenuOpen = false;
}

function fillAccessSelect(id: string) {
  const select = getEl<HTMLSelectElement>(id);
  if (!select) return;
  select.innerHTML = '';
  Object.keys(Access)
    .filter((k) => isNaN(Number(k)))
    .forEach((key) => {
      const val = (Access as any)[key];
      const option = document.createElement('option');
      option.value = val;
      option.text = key;
      select.appendChild(option);
    });
}
fillAccessSelect('accessSelect');
fillAccessSelect('myAccess');

const playerInput = getEl<HTMLInputElement>('playerName');
const opsRow = getEl<HTMLDivElement>('playerOpsRow');
function showOpsRow() {
  if (opsRow) show('playerOpsRow', 'flex');
}
playerInput?.addEventListener('input', showOpsRow);
showOpsRow();

function requirePlayerName(): string | null {
  const playerName = getInputValue('playerName').trim();
  if (!playerName) {
    displayChatMessage({
      message: 'Enter the player name.',
      scope: 'player',
      type: 'chat',
    });
    return null;
  }
  return playerName;
}

addEvent('kickBtn', 'click', async () => {
  const playerName = requirePlayerName();
  if (!playerName) return;
  const res = await modKick(playerName);
  chatResultMsg(
    (res as any)?.success,
    'Player kicked!',
    'Failed to kick player.',
  );
});
addEvent('banBtn', 'click', async () => {
  const playerName = requirePlayerName();
  if (!playerName) return;
  const reason = getInputValue('banReason');
  const duration = safeParseInt(getInputValue('banDuration'), 0);
  const until = duration > 0 ? Date.now() + duration * 60 * 1000 : undefined;
  const res = await modBan(playerName, reason, until);
  chatResultMsg(!!res, 'Player banned!', 'Failed to ban player.');
});
addEvent('bringBtn', 'click', async () => {
  const playerName = requirePlayerName();
  if (!playerName) return;
  const res = await modBring(playerName);
  chatResultMsg(!!res, 'Player brought to you!', 'Failed to bring player.');
});
addEvent('gotoBtn', 'click', async () => {
  const playerName = requirePlayerName();
  if (!playerName) return;
  const res = await modGoto(playerName);
  chatResultMsg(!!res, 'Teleported to player!', 'Failed to teleport.');
});
addEvent('setAccessBtn', 'click', async () => {
  const playerName = requirePlayerName();
  const accessLevel = getInputValue('accessSelect') as unknown as Access;
  if (!playerName || !accessLevel) {
    displayChatMessage({
      message: 'Enter player name and access.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modSetAccess(playerName, accessLevel);
  chatResultMsg(!!res, 'Access changed!', 'Failed to change access.');
});
addEvent('setSpriteBtn', 'click', async () => {
  const playerName = requirePlayerName();
  const spriteId = safeParseInt(getInputValue('spriteInput'), NaN);
  if (!playerName || isNaN(spriteId)) {
    displayChatMessage({
      message: 'Enter player name and sprite.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modSetSprite(playerName, spriteId);
  chatResultMsg(!!res, 'Sprite changed!', 'Failed to change sprite.');
});
addEvent('moveMapBtn', 'click', async () => {
  const mapId = getInputValue('mapId').trim();
  if (!mapId) {
    displayChatMessage({
      message: 'Enter the map ID.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modMoveMap(mapId);
  chatResultMsg(!!res, 'You have been moved to the map!', 'Failed to move.');
});
addEvent('setMyAccessBtn', 'click', async () => {
  const accessLevel = getInputValue('myAccess') as unknown as Access;
  if (!accessLevel) {
    displayChatMessage({
      message: 'Select an access level.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modSetMyAccess(accessLevel);
  chatResultMsg(
    !!res,
    'Your access was changed!',
    'Failed to change your access.',
  );
});
addEvent('setMySpriteBtn', 'click', async () => {
  const spriteId = safeParseInt(getInputValue('mySpriteInput'), NaN);
  if (isNaN(spriteId)) {
    displayChatMessage({
      message: 'Enter your new sprite id.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await changeSprite(spriteId);
  chatResultMsg(
    !!res,
    'Your sprite was changed!',
    'Failed to change your sprite.',
  );
});
