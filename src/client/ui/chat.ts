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
  } else {
    msgEl.textContent = `[${scope}] ${username}: ${message}`;

    if (scope === 'global') {
      msgEl.className = 'chat-global';
    } else if (scope === 'local') {
      msgEl.className = 'chat-local';
    }
  }

  chatBox.appendChild(msgEl);
  chatBox.scrollTop = chatBox.scrollHeight;
}
