// Places bots around the world through the admin console's `tp`, which
// needs the --admin-user and --admin-pass flags.
//
// Positions only separate players on maps larger than one screen.
// `assessWorld` checks that before the run, so a crowd is never reported
// under a spread label.

import {
  GAME_HEIGHT,
  GAME_WIDTH,
  TILE_SIZE,
} from '../../src/shared/constants.js';

export interface LoadMap {
  id: string;
  name: string;
  tileWidth: number;
  tileHeight: number;
}

export interface Placement {
  username: string;
  mapId: string;
  tileX: number;
  tileY: number;
}

export interface WorldAssessment {
  maps: number;
  /** Maps whose whole area fits inside one viewport, so position is moot. */
  screenSizedMaps: string[];
  /** Viewports that fit in the world side by side. A spread needs many. */
  viewportsAvailable: number;
  /** Players per screen this run will actually stand at, asked for or not. */
  perScreen: number;
  /** Empty when the world can express a spread. */
  warnings: string[];
}

/** Tiles left clear of the edges, so a placement is never in the border. */
const EDGE_MARGIN = 1;

/** What one player sees, in tiles: the unit density is counted in. */
const VIEWPORT_TILES_X = Math.ceil(GAME_WIDTH / TILE_SIZE);
const VIEWPORT_TILES_Y = Math.ceil(GAME_HEIGHT / TILE_SIZE);

/** More than this per screen makes the run a crowd, whatever its label. */
const CROWD_THRESHOLD = 10;

interface ViewportCell {
  map: LoadMap;
  originX: number;
  originY: number;
}

/**
 * The world cut into screens, in a fixed order. The criterion is players
 * per screen, and a map smaller than one screen still counts as one.
 */
function viewportCells(maps: LoadMap[]): ViewportCell[] {
  const cells: ViewportCell[] = [];
  for (const map of maps) {
    const across = Math.max(1, Math.floor(map.tileWidth / VIEWPORT_TILES_X));
    const down = Math.max(1, Math.floor(map.tileHeight / VIEWPORT_TILES_Y));
    for (let row = 0; row < down; row++) {
      for (let col = 0; col < across; col++) {
        cells.push({
          map,
          originX: col * VIEWPORT_TILES_X,
          originY: row * VIEWPORT_TILES_Y,
        });
      }
    }
  }
  return cells;
}

/** Density this run ends up at: what was asked, or what the world forces. */
function densityOf(cells: number, bots: number, perScreen?: number): number {
  if (cells === 0 || bots === 0) return 0;
  const spreadThin = Math.ceil(bots / cells);
  if (!perScreen || perScreen < 1) return spreadThin;
  // Placement cannot spread people thinner than the world allows.
  return Math.max(perScreen, spreadThin);
}

/** Maps an admin can see, reduced to the two numbers placement needs. */
export async function fetchMaps(
  baseUrl: string,
  cookie: string,
): Promise<LoadMap[]> {
  const res = await fetch(`${baseUrl}/maps`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`could not list maps: ${res.status}`);
  const raw = (await res.json()) as Array<{
    id: string;
    name?: string;
    tiles?: unknown[][];
  }>;
  return raw
    .map((m) => ({
      id: String(m.id),
      name: m.name ?? String(m.id),
      tileWidth: m.tiles?.[0]?.length ?? 0,
      tileHeight: m.tiles?.length ?? 0,
    }))
    .filter((m) => m.tileWidth > 0 && m.tileHeight > 0);
}

/**
 * Whether this world can express a spread at all. The number of viewports
 * that fit in it caps how far apart the population can be.
 */
export function assessWorld(
  maps: LoadMap[],
  bots: number,
  perScreen?: number,
): WorldAssessment {
  const screenSizedMaps = maps
    .filter(
      (map) =>
        map.tileWidth <= VIEWPORT_TILES_X && map.tileHeight <= VIEWPORT_TILES_Y,
    )
    .map((map) => map.id);
  const viewportsAvailable = viewportCells(maps).length;
  const density = densityOf(viewportsAvailable, bots, perScreen);

  const warnings: string[] = [];
  if (maps.length === 0) warnings.push('no maps to place bots on');
  if (screenSizedMaps.length === maps.length && maps.length > 0) {
    warnings.push(
      `every map is one screen or smaller (${screenSizedMaps.join(', ')}), so ` +
        `position cannot separate anyone - each map is a single viewport`,
    );
  }
  if (perScreen && perScreen >= 1 && density > perScreen) {
    warnings.push(
      `asked for ${perScreen} per screen, but ${bots} bots need ` +
        `${Math.ceil(bots / perScreen)} screens and the world has ` +
        `${viewportsAvailable}: this run stands at ${density} per screen`,
    );
  }
  if (density > CROWD_THRESHOLD) {
    warnings.push(
      `${bots} bots over ${viewportsAvailable} viewport(s) of room is ` +
        `${density} per screen: this run is a ` +
        `crowd scenario, whatever it is labelled`,
    );
  }

  return {
    maps: maps.length,
    screenSizedMaps,
    viewportsAvailable,
    perScreen: density,
    warnings,
  };
}

/**
 * Where each bot should stand: `perScreen` per screen of world, filling
 * screens in a fixed order until everyone is placed.
 *
 * Counting screens rather than maps keeps a one-screen town from holding a
 * crowd, and makes density a setting instead of a side effect of population.
 */
export function planPlacements(
  maps: LoadMap[],
  usernames: string[],
  perScreen?: number,
): Placement[] {
  const cells = viewportCells(maps);
  if (cells.length === 0 || usernames.length === 0) return [];

  const density = densityOf(cells.length, usernames.length, perScreen);
  const placements: Placement[] = [];
  for (let i = 0; i < usernames.length; i += density) {
    // Screens fill in order, so a small population occupies one contiguous
    // part of the world.
    const cell = cells[Math.floor(i / density) % cells.length]!;
    placements.push(...latticeIn(cell, usernames.slice(i, i + density)));
  }
  return placements;
}

/** Names spread over one screen, square-ish, never on the map border. */
function latticeIn(cell: ViewportCell, names: string[]): Placement[] {
  const { map } = cell;
  const minX = Math.max(EDGE_MARGIN, cell.originX);
  const minY = Math.max(EDGE_MARGIN, cell.originY);
  const usableX = Math.max(
    1,
    Math.min(map.tileWidth - EDGE_MARGIN, cell.originX + VIEWPORT_TILES_X) -
      minX,
  );
  const usableY = Math.max(
    1,
    Math.min(map.tileHeight - EDGE_MARGIN, cell.originY + VIEWPORT_TILES_Y) -
      minY,
  );

  // Square-ish, since the point is distance between neighbours on both axes.
  const columns = Math.max(
    1,
    Math.min(usableX, Math.ceil(Math.sqrt(names.length))),
  );
  const rows = Math.max(1, Math.ceil(names.length / columns));

  return names.map((username, i) => ({
    username,
    mapId: map.id,
    tileX: minX + Math.floor((((i % columns) + 0.5) * usableX) / columns),
    tileY:
      minY + Math.floor(((Math.floor(i / columns) + 0.5) * usableY) / rows),
  }));
}

/**
 * Where each bot should stand for a crowd run: one viewport of the start
 * map. Accounts keep their position between runs, so a crowd run has to
 * gather them again.
 */
export function planGathering(
  maps: LoadMap[],
  usernames: string[],
  mapId: string,
): Placement[] {
  const map = maps.find((m) => m.id === mapId) ?? maps[0];
  if (!map || usernames.length === 0) return [];

  // One screen, centred, since a crowd means everyone in view of each other.
  const viewportX = Math.ceil(GAME_WIDTH / TILE_SIZE);
  const viewportY = Math.ceil(GAME_HEIGHT / TILE_SIZE);
  const width = Math.max(
    1,
    Math.min(map.tileWidth - EDGE_MARGIN * 2, viewportX),
  );
  const height = Math.max(
    1,
    Math.min(map.tileHeight - EDGE_MARGIN * 2, viewportY),
  );
  const originX = EDGE_MARGIN + Math.floor((map.tileWidth - width) / 2);
  const originY = EDGE_MARGIN + Math.floor((map.tileHeight - height) / 2);

  // Several bots per tile is fine: `tp` goes through findPlacement, which
  // moves each one to the nearest free tile.
  return usernames.map((username, i) => ({
    username,
    mapId: map.id,
    tileX: originX + (i % width),
    tileY: originY + (Math.floor(i / width) % height),
  }));
}

export interface SpreadResult {
  placed: number;
  failed: number;
  /** First few failures, so a broken run says why rather than just how many. */
  errors: string[];
}

/**
 * Issues the placements through the admin console with bounded concurrency.
 * Each one spends a request against HTTP_RATE_LIMIT_MAX.
 */
export async function applyPlacements(
  baseUrl: string,
  cookie: string,
  placements: Placement[],
  concurrency = 25,
): Promise<SpreadResult> {
  const result: SpreadResult = { placed: 0, failed: 0, errors: [] };

  for (let i = 0; i < placements.length; i += concurrency) {
    const wave = placements.slice(i, i + concurrency);
    const outcomes = await Promise.allSettled(
      wave.map(async (p) => {
        const res = await fetch(`${baseUrl}/admin/console`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: cookie },
          body: JSON.stringify({
            line: `tp ${p.username} ${p.mapId} ${p.tileX} ${p.tileY}`,
          }),
        });
        if (!res.ok) throw new Error(`${p.username}: HTTP ${res.status}`);
        const body = (await res.json()) as { output?: string[] };
        const output = (body.output ?? []).join(' ');
        // `tp` answers 200 even when it refuses, so the body is checked.
        if (!/Teleported/i.test(output)) {
          throw new Error(
            `${p.username}: ${output.slice(0, 80) || 'no output'}`,
          );
        }
      }),
    );

    for (const outcome of outcomes) {
      if (outcome.status === 'fulfilled') result.placed++;
      else {
        result.failed++;
        if (result.errors.length < 5) {
          result.errors.push(String(outcome.reason).slice(0, 120));
        }
      }
    }
  }

  return result;
}

/** How uneven the result is, read back from the server rather than assumed. */
export function summarizeDistribution(
  byMap: Array<{ mapId: string; players: number }>,
): string {
  if (byMap.length === 0) return 'no per-map data';
  const occupied = byMap.filter((m) => m.players > 0);
  const counts = occupied.map((m) => m.players);
  const most = Math.max(0, ...counts);
  return (
    `${occupied.length}/${byMap.length} maps occupied, ` +
    `busiest holds ${most}` +
    (occupied.length > 0
      ? ` (${occupied.map((m) => `${m.mapId}:${m.players}`).join(' ')})`
      : '')
  );
}
