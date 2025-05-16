import { ChatMessagePayload } from '../../shared/types';

export function displayChatMessage({
  username,
  message,
  scope,
  subtype,
}: ChatMessagePayload) {
  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;

  const msgEl = document.createElement('div');

  if (!username) {
    msgEl.textContent = message;
    if (subtype === 'death') {
      msgEl.className = 'chat-death';
    }
    if (scope === 'player') {
      msgEl.className = 'chat-player';
    }
  } else {
    msgEl.textContent = `[${scope}] ${username}: ${message}`;

    if (scope === 'global') {
      msgEl.className = 'chat-global';
    } else if (scope === 'map') {
      msgEl.className = 'chat-map';
    }
  }

  chatBox.appendChild(msgEl);
  chatBox.scrollTop = chatBox.scrollHeight;
}

export function chatResultMsg(
  success: boolean,
  okMsg: string,
  failMsg: string,
) {
  displayChatMessage({
    message: success ? okMsg : failMsg,
    scope: 'player',
    type: 'chat',
  });
}
