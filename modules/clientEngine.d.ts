// Types for the client-side `engine` object given to module scripts.

interface PanelApi {
  toggle(): void;
  show(): void;
  remove(): void;
  isOpen(): boolean;
  setTitle(title: string): void;
  setBody(...elements: (Node | string)[]): void;
  element: HTMLElement;
}

interface ModuleUi {
  panel(options: { title: string }): PanelApi;
  button(label: string, onClick?: () => void): HTMLButtonElement;
  input(placeholder: string): HTMLInputElement;
  row(...elements: HTMLElement[]): HTMLElement;
  actionButton(label: string, onClick: () => void, hotkey?: string): HTMLButtonElement;
}

declare const engine: {
  ui: ModuleUi;
  sendServerEvent(channel: string, payload?: unknown): void;
  onServerEvent(channel: string, handler: (payload: any) => void): void;
  registerPlayerAction(label: string, handler: (name: string) => void): void;
};
