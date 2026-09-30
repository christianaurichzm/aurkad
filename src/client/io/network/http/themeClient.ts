import type { Theme, ThemeImage } from '../../../../shared/theme';
import { httpClient } from './httpClient';

// The admin panel's Appearance page: theme/theme.json and its pictures. A
// player's client only gets the result, from /game and /theme/theme.css.

/** `handwritten`: the game also has a theme.css, which wins over all of it. */
export const fetchTheme = () =>
  httpClient<{ theme: Theme; handwritten: boolean }>('/admin/theme', {
    method: 'GET',
  });

/** Everything but the pictures, which are saved as they are uploaded. */
export const saveTheme = ({ logo: _, background: __, ...choices }: Theme) =>
  httpClient<Theme>('/admin/theme', { method: 'PUT', body: choices });

export const uploadThemeImage = (slot: ThemeImage, file: File) =>
  httpClient<Theme>(`/admin/theme/${slot}`, { method: 'PUT', body: file });

export const removeThemeImage = (slot: ThemeImage) =>
  httpClient<Theme>(`/admin/theme/${slot}`, { method: 'DELETE' });
