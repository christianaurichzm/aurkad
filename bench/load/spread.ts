// Places bots around the world through the admin console's `tp`, which
// needs the --admin-user and --admin-pass flags.
//
// Positions only separate players on maps larger than one screen.
// `assessWorld` checks that before the run, so a crowd is never reported
// under a spread label.

import { GAME_HEIGHT, GAME_WIDTH, TILE_SIZE } from '../../src/shared/constants.js';

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
  /** Empty when the world can express a spread. */
  warnings: string[];
}

/** Tiles left clear of the edges, so a placement is never in the border. */
const EDGE_MARGIN = 1;

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
export function assessWorld(maps: LoadMap[], bots: number): WorldAssessment {
  const viewportTilesX = Math.ceil(GAME_WIDTH / TILE_SIZE);
  const viewportTilesY = Math.ceil(GAME_HEIGHT / TILE_SIZE);

  const screenSizedMaps: string[] = [];
  let viewportsAvailable = 0;
  for (const map of maps) {
    const across = Math.max(1, Math.floor(map.tileWidth / viewportTilesX));
    const down = Math.max(1, Math.floor(map.tileHeight / viewportTilesY));
    viewportsAvailable += across * down;
    if (map.tileWidth <= viewportTilesX && map.tileHeight <= viewportTilesY) {
      screenSizedMaps.push(map.id);
    }
  }

  const warnings: string[] = [];
  if (maps.length === 0) warnings.push('no maps to place bots on');
  if (screenSizedMaps.length === maps.length && maps.length > 0) {
    warnings.push(
      `every map is one screen or smaller (${screenSizedMaps.join(', ')}), so ` +
        `position cannot separate anyone - each map is a single viewport`,
    );
  }
  if (viewportsAvailable > 0 && bots / viewportsAvailable > 10) {
    warnings.push(
      `${bots} bots over ${viewportsAvailable} viewport(s) of room is ` +
        `${Math.round(bots / viewportsAvailable)} per screen: this run is a ` +
        `crowd scenario, whatever it is labelled`,
    );
  }

  return {
    maps: maps.length,
    screenSizedMaps,
    viewportsAvailable,
    warnings,
  };
}

/**
 * Where each bot should stand: round robin across maps, then a lattice
 * within each map, so the population is as far apart as the world allows.
 * Repeatable, so a load number that moves between runs is the server
 * changing, not the placement.
 */
export function planPlacements(
  maps: LoadMap[],
  usernames: string[],
): Placement[] {
  if (maps.length === 0) return [];

  const perMap = new Map<string, string[]>();
  usernames.forEach((username, i) => {
    const map = maps[i % maps.length]!;
    const list = perMap.get(map.id) ?? [];
    list.push(username);
    perMap.set(map.id, list);
  });

  const placements: Placement[] = [];
  for (const map of maps) {
    const names = perMap.get(map.id) ?? [];
    if (names.length === 0) continue;

    const usableX = Math.max(1, map.tileWidth - EDGE_MARGIN * 2);
    const usableY = Math.max(1, map.tileHeight - EDGE_MARGIN * 2);
    // Square-ish, since the point is distance between neighbours on both axes.
    const columns = Math.max(1, Math.min(usableX, Math.ceil(Math.sqrt(names.length))));
    const rows = Math.max(1, Math.ceil(names.length / columns));

    names.forEach((username, i) => {
      const col = i % columns;
      const row = Math.floor(i / columns);
      placements.push({
        username,
        mapId: map.id,
        tileX: EDGE_MARGIN + Math.floor(((col + 0.5) * usableX) / columns),
        tileY: EDGE_MARGIN + Math.floor(((row + 0.5) * usableY) / rows),
      });
    });
  }
  return placements;
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
          throw new Error(`${p.username}: ${output.slice(0, 80) || 'no output'}`);
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
