import { create } from 'zustand';
import type {
  ChatMessagePayload,
  ChatScope,
  MapType,
} from '../../shared/types';

interface ConnectionState {
  message: string;
  isError: boolean;
  visible: boolean;
}

interface PlayerHealthState {
  current: number;
  max: number;
  level?: number;
}

interface PlayerXpState {
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

export type DialogKind = 'info' | 'error' | 'confirm';

export interface DialogOptions {
  title: string;
  message: string;
  kind?: DialogKind;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface DialogState extends Required<Omit<DialogOptions, 'kind'>> {
  visible: boolean;
  kind: DialogKind;
  resolve?: (confirmed: boolean) => void;
}

interface UIState {
  mapEdited: boolean;
  setMapEdited: (edited: boolean) => void;

  connectionStatus: ConnectionState;
  showConnectionStatus: (message: string, isError?: boolean) => void;
  hideConnectionStatus: () => void;

  playerHealth: PlayerHealthState;
  setPlayerHealth: (current: number, max: number, level?: number) => void;

  playerXp: PlayerXpState;
  setPlayerXp: (current: number, max: number) => void;

  currentMap: MapState | null;
  setCurrentMap: (map: { id: string; name: string; type: MapType }) => void;

  chat: ChatState;
  addChatMessage: (message: ChatMessagePayload) => void;
  setChatInput: (value: string) => void;
  setChatScope: (scope: ChatScope) => void;
  clearChatInput: () => void;

  attackCooldownUntil: number;
  setAttackCooldown: (durationMs: number) => void;

  dialog: DialogState;
  showDialog: (options: DialogOptions) => Promise<boolean>;
  closeDialog: (confirmed: boolean) => void;
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
    level: 1,
  },
  setPlayerHealth: (current, max, level) =>
    set((state) => ({
      playerHealth: {
        current,
        max,
        level: level ?? state.playerHealth.level,
      },
    })),

  playerXp: {
    current: 0,
    max: 100,
  },
  setPlayerXp: (current, max) => set({ playerXp: { current, max } }),

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

  attackCooldownUntil: 0,
  setAttackCooldown: (durationMs) =>
    set({ attackCooldownUntil: Date.now() + durationMs }),

  dialog: {
    visible: false,
    title: '',
    message: '',
    kind: 'info',
    confirmLabel: 'OK',
    cancelLabel: 'Cancel',
  },
  showDialog: (options) =>
    new Promise<boolean>((resolve) => {
      set({
        dialog: {
          visible: true,
          title: options.title,
          message: options.message,
          kind: options.kind ?? 'info',
          confirmLabel: options.confirmLabel ?? 'OK',
          cancelLabel: options.cancelLabel ?? 'Cancel',
          resolve,
        },
      });
    }),
  closeDialog: (confirmed) =>
    set((state) => {
      state.dialog.resolve?.(confirmed);
      return {
        dialog: {
          visible: false,
          title: '',
          message: '',
          kind: 'info',
          confirmLabel: 'OK',
          cancelLabel: 'Cancel',
        },
      };
    }),
}));
