import React, { useEffect, useRef, useState } from 'react';
import { ChatMessagePayload, ChatScope } from '../../shared/types';
import { updateChat, sendChatMessage } from '../io/network';
import { useUIStore } from '../stores/uiStore';
import { useT, type TranslationKey } from '../i18n';

// Which lines the log shows. 'player' is what was said to this player alone:
// command replies, script messages, an operator's whisper.
const tabs: { id: ChatScope | 'all'; label: TranslationKey }[] = [
  { id: 'all', label: 'chat.tabAll' },
  { id: 'map', label: 'chat.scopeMap' },
  { id: 'global', label: 'chat.scopeGlobal' },
  { id: 'player', label: 'chat.tabSystem' },
];

export const ChatPanel: React.FC = () => {
  const t = useT();
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const messages = useUIStore((state) => state.chat.messages);
  const inputValue = useUIStore((state) => state.chat.inputValue);
  const scope = useUIStore((state) => state.chat.scope);
  const setChatInput = useUIStore((state) => state.setChatInput);
  const setChatScope = useUIStore((state) => state.setChatScope);
  const [tab, setTab] = useState<ChatScope | 'all'>('all');
  const shown =
    tab === 'all' ? messages : messages.filter((msg) => msg.scope === tab);

  useEffect(() => {
    const onMessage = () => updateChat();
    window.addEventListener('chat-update', onMessage);
    return () => window.removeEventListener('chat-update', onMessage);
  }, []);

  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, tab]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  };

  const getChatMessageClassName = (msg: ChatMessagePayload) => {
    const channel =
      msg.subtype === 'death' ? 'chat-death' : `chat-${msg.scope}`;
    return msg.username ? channel : `${channel} chat-notice`;
  };

  return (
    <section id="chatContainer" className="panel" aria-label={t('chat.title')}>
      <div className="chat-tabs" role="tablist">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            className="chat-tab"
            aria-selected={tab === id}
            aria-controls="chatBox"
            onClick={() => setTab(id)}
          >
            {t(label)}
          </button>
        ))}
      </div>
      <div id="chatBox" className="chat-box" ref={chatBoxRef}>
        {shown.length === 0 && <p className="chat-empty">{t('chat.empty')}</p>}
        {shown.map((msg, index) => (
          <div key={index} className={getChatMessageClassName(msg)}>
            {msg.username ? (
              <>
                <span className="chat-who">{msg.username}</span>
                {': '}
                {msg.message}
              </>
            ) : (
              msg.message
            )}
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
    </section>
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
