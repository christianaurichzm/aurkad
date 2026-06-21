export const colors = {
  primary: '#2ecc40',
  primaryHover: '#219b3a',
  success: '#27ae60',
  danger: '#e74c3c',
  dangerDark: '#c0392b',
  info: '#3498db',
  warning: '#f1c40f',
  text: '#333333',
  textMuted: '#666666',
  surface: '#ffffff',
  surfaceMuted: '#f5f5f5',
  border: '#dddddd',
  overlay: 'rgba(0, 0, 0, 0.55)',
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
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
