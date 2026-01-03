import { ChatMessagePayload } from '../../../../shared/types';
import type { WsClientMessage } from '../../../../shared/wsProtocol';
import { useUIStore } from '../../../stores/uiStore';

const chatQueue: ChatMessagePayload[] = [];
let socketSender: ((action: WsClientMessage) => void) | null = null;

export function setChatSocketSender(sender: (action: WsClientMessage) => void) {
  socketSender = sender;
}

export function enqueueChatMessage(message: ChatMessagePayload) {
  chatQueue.push(message);
}

export function updateChat(): void {
  while (chatQueue.length > 0) {
    const message = chatQueue.shift();
    if (message) {
      useUIStore.getState().addChatMessage(message);
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
