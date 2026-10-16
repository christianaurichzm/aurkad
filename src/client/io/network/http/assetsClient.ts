import type { SHEETS, SpriteLayoutName } from '../../../../shared/mappings';
import { httpClient } from './httpClient';

/**
 * The Art page of the admin panel. `layout`, for characters only, rewrites
 * sprites.json to read the sheet as drawn; without it the one there stays.
 */
export const uploadSheet = (
  sheet: (typeof SHEETS)[number],
  file: File,
  layout?: SpriteLayoutName,
) =>
  httpClient<string>(
    `/admin/assets/${sheet}${layout ? `?layout=${layout}` : ''}`,
    { method: 'PUT', body: file },
  );
