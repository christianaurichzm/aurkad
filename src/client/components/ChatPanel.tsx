import React, { useEffect, useRef } from 'react';
import { ChatMessagePayload } from '../../shared/types';
import { updateChat, sendChatMessage } from '../io/network';

export const ChatPanel: React.FC = () => {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onMessage = () => updateChat();
    window.addEventListener('chat-update', onMessage);
    return () => window.removeEventListener('chat-update', onMessage);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  };

  return (
    <div id="chatContainer">
      <div id="chatBox" className="chat-box" />

      <div id="chatInputContainer">
        <select id="chatScope">
          <option value="map">Map</option>
          <option value="global">Global</option>
        </select>

        <input
          id="chatInput"
          type="text"
          placeholder="Mensagem..."
          ref={inputRef}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
};

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
