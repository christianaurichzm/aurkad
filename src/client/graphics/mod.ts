import { Access } from '../../shared/types';
import { toggleTilesetEditor } from '../graphics/tileset';
import {
  modKick,
  modBring,
  modGoto,
  modSetAccess,
  modSetSprite,
  modMoveMap,
  modSetMyAccess,
  changeSprite,
} from '../io/network';
import { displayChatMessage } from '../ui/chat';

let isModMenuOpen = false;

export function toggleModMenu() {
  const modContainer = document.getElementById('modContainer');
  const tilesetContainer = document.getElementById('tilesetContainer');

  if (!modContainer || !tilesetContainer) return;

  if (modContainer.style.display === 'flex') {
    modContainer.style.display = 'none';
    isModMenuOpen = false;
  } else {
    if (tilesetContainer.style.display === 'flex') {
      toggleTilesetEditor();
    }
    modContainer.style.display = 'flex';
    isModMenuOpen = true;
  }
}

export function closeModMenu() {
  const modContainer = document.getElementById('modContainer');
  if (modContainer) {
    modContainer.style.display = 'none';
    isModMenuOpen = false;
  }
}

function fillAccessSelect(id: string) {
  const select = document.getElementById(id) as HTMLSelectElement;
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

const playerInput = document.getElementById('playerName') as HTMLInputElement;
const opsRow = document.getElementById('playerOpsRow') as HTMLDivElement;

function updateOpsRowVisibility() {
  opsRow.style.display = 'flex';
}
playerInput.addEventListener('input', updateOpsRowVisibility);
updateOpsRowVisibility();

document.getElementById('kickBtn')!.addEventListener('click', async () => {
  const playerName = (document.getElementById('playerName') as HTMLInputElement)
    .value;
  if (!playerName) {
    displayChatMessage({
      message: 'Enter the player name.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }

  const res = await modKick(playerName);

  if ((res as any)?.success) {
    displayChatMessage({
      message: 'Player kicked!',
      scope: 'player',
      type: 'chat',
    });
  } else {
    displayChatMessage({
      message: 'Failed to kick player.',
      scope: 'player',
      type: 'chat',
    });
  }
});

document.getElementById('bringBtn')!.addEventListener('click', async () => {
  const playerName = (
    document.getElementById('playerName') as HTMLInputElement
  ).value.trim();
  if (!playerName) {
    displayChatMessage({
      message: 'Enter the player name.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modBring(playerName);
  displayChatMessage({
    message: res ? 'Player brought to you!' : 'Failed to bring player.',
    scope: 'player',
    type: 'chat',
  });
});

document.getElementById('gotoBtn')!.addEventListener('click', async () => {
  const playerName = (
    document.getElementById('playerName') as HTMLInputElement
  ).value.trim();
  if (!playerName) {
    displayChatMessage({
      message: 'Enter the player name.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modGoto(playerName);
  displayChatMessage({
    message: res ? 'Teleported to player!' : 'Failed to teleport.',
    scope: 'player',
    type: 'chat',
  });
});

document.getElementById('setAccessBtn')!.addEventListener('click', async () => {
  const playerName = (
    document.getElementById('playerName') as HTMLInputElement
  ).value.trim();
  const accessLevel = (
    document.getElementById('accessSelect') as HTMLSelectElement
  ).value as unknown as Access;
  if (!playerName || !accessLevel) {
    displayChatMessage({
      message: 'Enter player name and access.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modSetAccess(playerName, accessLevel);
  displayChatMessage({
    message: res ? 'Access changed!' : 'Failed to change access.',
    scope: 'player',
    type: 'chat',
  });
});

document.getElementById('setSpriteBtn')!.addEventListener('click', async () => {
  const playerName = (
    document.getElementById('playerName') as HTMLInputElement
  ).value.trim();
  const spriteId = Number(
    (document.getElementById('spriteInput') as HTMLInputElement).value,
  );
  if (!playerName || isNaN(spriteId)) {
    displayChatMessage({
      message: 'Enter player name and sprite.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modSetSprite(playerName, spriteId);
  displayChatMessage({
    message: res ? 'Sprite changed!' : 'Failed to change sprite.',
    scope: 'player',
    type: 'chat',
  });
});

document.getElementById('moveMapBtn')!.addEventListener('click', async () => {
  const mapId = (
    document.getElementById('mapId') as HTMLInputElement
  ).value.trim();
  if (!mapId) {
    displayChatMessage({
      message: 'Enter the map ID.',
      scope: 'player',
      type: 'chat',
    });
    return;
  }
  const res = await modMoveMap(mapId);
  displayChatMessage({
    message: res ? 'You have been moved to the map!' : 'Failed to move.',
    scope: 'player',
    type: 'chat',
  });
});

document
  .getElementById('setMyAccessBtn')!
  .addEventListener('click', async () => {
    const accessLevel = (
      document.getElementById('myAccess') as HTMLSelectElement
    ).value as unknown as Access;
    if (!accessLevel) {
      displayChatMessage({
        message: 'Select an access level.',
        scope: 'player',
        type: 'chat',
      });
      return;
    }
    const res = await modSetMyAccess(accessLevel);
    displayChatMessage({
      message: res
        ? 'Your access was changed!'
        : 'Failed to change your access.',
      scope: 'player',
      type: 'chat',
    });
  });

document
  .getElementById('setMySpriteBtn')!
  .addEventListener('click', async () => {
    const spriteId = Number(
      (document.getElementById('mySpriteInput') as HTMLInputElement).value,
    );
    if (isNaN(spriteId)) {
      displayChatMessage({
        message: 'Enter your new sprite id.',
        scope: 'player',
        type: 'chat',
      });
      return;
    }

    const res = await changeSprite(spriteId);

    displayChatMessage({
      message: res
        ? 'Your sprite was changed!'
        : 'Failed to change your sprite.',
      scope: 'player',
      type: 'chat',
    });
  });
