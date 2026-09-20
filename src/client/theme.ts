// CSS variables are shared by React panels and the game shell.
export const colors = {
  primary: 'var(--color-primary)',
  primaryHover: 'var(--color-primary-hover)',
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  dangerText: 'var(--color-danger-text)',
  dangerDark: 'var(--color-danger-dark)',
  info: 'var(--color-info)',
  warning: 'var(--color-warning)',
  text: 'var(--color-text)',
  textMuted: 'var(--color-text-muted)',
  surface: 'var(--color-surface)',
  surfaceMuted: 'var(--color-surface-muted)',
  border: 'var(--color-border)',
  overlay: 'var(--color-overlay)',
  app: 'var(--color-app-bg)',
  selected: 'var(--color-selected)',
  dangerMuted: 'var(--color-danger-muted)',
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 6,
} as const;

export const zIndex = {
  canvasBase: 1,
  canvasItems: 2,
  canvasGrid: 3,
  canvasActors: 4,
  gameOverlay: 50,
  hud: 100,
  panel: 150,
  editor: 500,
  modalOverlay: 1000,
  modal: 1001,
  floatingPanel: 1002,
  tooltip: 1100,
  auth: 2000,
  dialogOverlay: 9000,
  dialog: 9001,
  toast: 10000,
} as const;

export const shadow = {
  panel: '0 5px 25px rgba(0, 0, 0, 0.3)',
  modal: '0 12px 32px rgba(0, 0, 0, 0.28)',
  raised: '0 2px 8px rgba(0, 0, 0, 0.2)',
} as const;
