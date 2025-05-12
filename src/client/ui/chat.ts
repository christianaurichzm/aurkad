import { ClientChatAction } from '../../shared/types';

export function displayChatMessage({
  username,
  message,
  scope,
}: ClientChatAction) {
  const chatBox = document.getElementById('chatBox');
  if (!chatBox) return;

  const msgEl = document.createElement('div');
  msgEl.textContent = `[${scope}] ${username}: ${message}`;
  msgEl.className = scope === 'global' ? 'chat-global' : 'chat-local';
  chatBox.appendChild(msgEl);
  chatBox.scrollTop = chatBox.scrollHeight;
}
