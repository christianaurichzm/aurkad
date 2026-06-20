export type ServerMode = 'normal' | 'maintenance' | 'gm_only';

export const serverState = {
  mode: 'normal' as ServerMode,
  motd: '',
};
