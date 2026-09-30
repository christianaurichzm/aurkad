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

const lineClass = (msg: ChatMessagePayload) => {
  const channel = msg.subtype === 'death' ? 'chat-death' : `chat-${msg.scope}`;
  return msg.username ? channel : `${channel} chat-notice`;
};

const lineText = (msg: ChatMessagePayload) =>
  msg.username ? (
    <>
      <span className="chat-who">{msg.username}</span>
      {': '}
      {msg.message}
    </>
  ) : (
    msg.message
  );

// More than an upright phone has room for; the box clips the oldest.
const PEEK_LINES = 12;

/**
 * The last lines said, where there is room for them and not for the panel:
 * under the world on an upright phone (styles.css). Touching it opens the
 * menu, where the chat itself is.
 */
export const ChatPeek: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const t = useT();
  const messages = useUIStore((state) => state.chat.messages);
  return (
    <button
      type="button"
      className="chat-box chat-peek"
      aria-label={t('chat.title')}
      aria-controls="sidePanel"
      onClick={onOpen}
    >
      {messages.length === 0 && (
        <span className="chat-empty">{t('chat.empty')}</span>
      )}
      {messages.slice(-PEEK_LINES).map((msg, index) => (
        <span key={index} className={lineClass(msg)}>
          {lineText(msg)}
        </span>
      ))}
    </button>
  );
};

/** `shown`: on a small screen the panel sits in a menu that opens and shuts. */
export const ChatPanel: React.FC<{ shown?: boolean }> = ({ shown = true }) => {
  const t = useT();
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const messages = useUIStore((state) => state.chat.messages);
  const inputValue = useUIStore((state) => state.chat.inputValue);
  const scope = useUIStore((state) => state.chat.scope);
  const setChatInput = useUIStore((state) => state.setChatInput);
  const setChatScope = useUIStore((state) => state.setChatScope);
  const [tab, setTab] = useState<ChatScope | 'all'>('all');
  // Only the bar under the world folds the chat up (styles.css); beside the
  // world it is always open, and the button is not drawn.
  const [expanded, setExpanded] = useState(false);
  const lines =
    tab === 'all' ? messages : messages.filter((msg) => msg.scope === tab);

  useEffect(() => {
    const onMessage = () => updateChat();
    window.addEventListener('chat-update', onMessage);
    return () => window.removeEventListener('chat-update', onMessage);
  }, []);

  // Shut, the box has no height to scroll: the last line is found again when
  // the menu opens.
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, tab, shown]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendChatMessage();
    }
  };

  return (
    <section
      id="chatContainer"
      className={expanded ? 'panel is-expanded' : 'panel'}
      aria-label={t('chat.title')}
    >
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
        {lines.length === 0 && <p className="chat-empty">{t('chat.empty')}</p>}
        {lines.map((msg, index) => (
          <div key={index} className={lineClass(msg)}>
            {lineText(msg)}
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
      <button
        type="button"
        className="chat-expand"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        {t(expanded ? 'chat.collapse' : 'chat.expand')}
      </button>
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
