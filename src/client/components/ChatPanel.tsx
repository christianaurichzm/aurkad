import React, { useEffect, useRef } from 'react';
import { ChatMessagePayload, ChatScope } from '../../shared/types';
import { updateChat, sendChatMessage } from '../io/network';
import { useUIStore } from '../stores/uiStore';
import { useT } from '../i18n';

export const ChatPanel: React.FC = () => {
  const t = useT();
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const messages = useUIStore((state) => state.chat.messages);
  const inputValue = useUIStore((state) => state.chat.inputValue);
  const scope = useUIStore((state) => state.chat.scope);
  const setChatInput = useUIStore((state) => state.setChatInput);
  const setChatScope = useUIStore((state) => state.setChatScope);

  useEffect(() => {
    const onMessage = () => updateChat();
    window.addEventListener('chat-update', onMessage);
    return () => window.removeEventListener('chat-update', onMessage);
  }, []);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  };

  const getChatMessageClassName = (msg: ChatMessagePayload) => {
    if (msg.subtype === 'death') return 'chat-death';
    if (msg.scope === 'player') return 'chat-player';
    if (msg.scope === 'global') return 'chat-global';
    if (msg.scope === 'map') return 'chat-map';
    return '';
  };

  const formatChatMessage = (msg: ChatMessagePayload) => {
    if (!msg.username) return msg.message;
    return `[${msg.scope}] ${msg.username}: ${msg.message}`;
  };

  return (
    <div id="chatContainer">
      <div className="panel-title">{t('chat.title')}</div>
      <div id="chatBox" className="chat-box" ref={chatBoxRef}>
        {messages.length === 0 && (
          <p className="chat-empty">{t('chat.empty')}</p>
        )}
        {messages.map((msg, index) => (
          <div key={index} className={getChatMessageClassName(msg)}>
            {formatChatMessage(msg)}
          </div>
        ))}
      </div>

      <div id="chatInputContainer">
        <select
          id="chatScope"
          value={scope}
          onChange={(e) => setChatScope(e.target.value as ChatScope)}
        >
          <option value="map">{t('chat.scopeMap')}</option>
          <option value="global">{t('chat.scopeGlobal')}</option>
        </select>

        <input
          id="chatInput"
          type="text"
          placeholder={t('chat.placeholder')}
          value={inputValue}
          onChange={(e) => setChatInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
};

export function displayChatMessage(message: ChatMessagePayload) {
  useUIStore.getState().addChatMessage(message);
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
