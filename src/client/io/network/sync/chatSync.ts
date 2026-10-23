import { ChatMessagePayload } from '../../../../shared/types';
import type { WsClientMessage } from '../../../../shared/wsProtocol';
import { useUIStore } from '../../../stores/uiStore';
import { setPlayerSpeech } from '../../../graphics/speechBubble';

const chatQueue: ChatMessagePayload[] = [];
let socketSender: ((action: WsClientMessage) => void) | null = null;

export function setChatSocketSender(sender: (action: WsClientMessage) => void) {
  socketSender = sender;
}

export function enqueueChatMessage(message: ChatMessagePayload) {
  chatQueue.push(message);
  // A hidden tab draws no frames, and frames drain this queue: without this a
  // background tab holds every line and adds them all when it comes back.
  if (document.hidden) updateChat();
}

export function updateChat(): void {
  while (chatQueue.length > 0) {
    const message = chatQueue.shift();
    if (message) {
      useUIStore.getState().addChatMessage(message);
      if (message.scope === 'map' && message.username) {
        setPlayerSpeech(message.username, message.message);
      }
    }
  }
}

export function sendChatMessage() {
  const { chat, clearChatInput } = useUIStore.getState();
  const message = chat.inputValue.trim();

  if (!message || !socketSender) return;

  const action: WsClientMessage = {
    type: 'chat',
    scope: chat.scope,
    message,
  };

  socketSender(action);
  clearChatInput();
}
