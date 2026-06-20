import { create } from 'zustand';
import type {
  ChatMessagePayload,
  ChatScope,
  MapStateClient,
} from '../../shared/types';

interface ConnectionState {
  message: string;
  isError: boolean;
  visible: boolean;
}

interface PlayerHealthState {
  current: number;
  max: number;
}

interface ChatState {
  messages: ChatMessagePayload[];
  inputValue: string;
  scope: ChatScope;
}

interface MapState {
  id: string;
  name: string;
  type: 'normal' | 'pvp';
}

interface UIState {
  mapEdited: boolean;
  setMapEdited: (edited: boolean) => void;

  connectionStatus: ConnectionState;
  showConnectionStatus: (message: string, isError?: boolean) => void;
  hideConnectionStatus: () => void;

  playerHealth: PlayerHealthState;
  setPlayerHealth: (current: number, max: number) => void;

  currentMap: MapState | null;
  setCurrentMap: (map: MapStateClient) => void;

  chat: ChatState;
  addChatMessage: (message: ChatMessagePayload) => void;
  setChatInput: (value: string) => void;
  setChatScope: (scope: ChatScope) => void;
  clearChatInput: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  mapEdited: false,
  setMapEdited: (edited) => set({ mapEdited: edited }),

  connectionStatus: {
    message: '',
    isError: false,
    visible: false,
  },
  showConnectionStatus: (message, isError = false) =>
    set({
      connectionStatus: {
        message,
        isError,
        visible: true,
      },
    }),
  hideConnectionStatus: () =>
    set((state) => ({
      connectionStatus: {
        ...state.connectionStatus,
        visible: false,
      },
    })),

  playerHealth: {
    current: 100,
    max: 100,
  },
  setPlayerHealth: (current, max) =>
    set({
      playerHealth: { current, max },
    }),

  currentMap: null,
  setCurrentMap: (map) =>
    set({
      currentMap: {
        id: map.id,
        name: map.name,
        type: map.type,
      },
    }),

  chat: {
    messages: [],
    inputValue: '',
    scope: 'map',
  },
  addChatMessage: (message) =>
    set((state) => ({
      chat: {
        ...state.chat,
        messages: [...state.chat.messages, message],
      },
    })),
  setChatInput: (value) =>
    set((state) => ({
      chat: {
        ...state.chat,
        inputValue: value,
      },
    })),
  setChatScope: (scope) =>
    set((state) => ({
      chat: {
        ...state.chat,
        scope,
      },
    })),
  clearChatInput: () =>
    set((state) => ({
      chat: {
        ...state.chat,
        inputValue: '',
      },
    })),
}));
