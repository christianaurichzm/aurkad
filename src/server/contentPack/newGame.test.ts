import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ITEMS,
  NPCS,
  RESPAWN,
  buildMap,
  drawItems,
  drawSprites,
  drawTiles,
  encodePng,
  writeGame,
} from './newGame.js';
import { loadGameConfig } from '../gameConfig.js';
import { SPRITE_WIDTH, TILE_SIZE, ITEM_SIZE } from '../../shared/constants.js';

describe('encodePng', () => {
  it('writes chunks a decoder accepts, holding the pixels drawn', () => {
    const sheet = drawTiles();
    const png = encodePng(sheet);
    let idat = Buffer.alloc(0);
    for (let at = 8; at < png.length;) {
      const length = png.readUInt32BE(at);
      const type = png.toString('ascii', at + 4, at + 8);
      if (type === 'IHDR') {
        expect(png.readUInt32BE(at + 8)).toBe(sheet.width);
        expect(png.readUInt32BE(at + 12)).toBe(sheet.height);
      }
      if (type === 'IDAT')
        idat = Buffer.concat([idat, png.subarray(at + 8, at + 8 + length)]);
      at += length + 12;
    }
    const raw = inflateSync(idat);
    const stride = sheet.width * 4 + 1;
    for (let y = 0; y < sheet.height; y++) {
      expect(raw[y * stride]).toBe(0);
      expect(
        raw
          .subarray(y * stride + 1, (y + 1) * stride)
          .equals(sheet.px.subarray(y * (stride - 1), (y + 1) * (stride - 1))),
      ).toBe(true);
    }
  });

  it('leaves the first tile pixel transparent so the client does not colour-key the sheet', () => {
    expect(drawTiles().px[3]).toBe(0);
  });
});

describe.each(['orthogonal', 'isometric'] as const)(
  'the generated %s content',
  (orientation) => {
    const map = buildMap(orientation);
    const tiles = drawTiles();
    const tileCells = (tiles.width / TILE_SIZE) * (tiles.height / TILE_SIZE);
    const characters = drawSprites().width / (4 * SPRITE_WIDTH);
    const itemCells = drawItems().width / ITEM_SIZE;

    it('only points at cells the sheets have', () => {
      for (const tile of map.tiles.flat()) {
        expect(tile.tileIndex).toBeLessThan(tileCells);
        expect(tile.maskIndex ?? 0).toBeLessThan(tileCells);
      }
      for (const npc of NPCS) expect(npc.sprite).toBeLessThan(characters);
      for (const item of ITEMS) expect(item.sprite).toBeLessThan(itemCells);
    });

    it('only refers to npcs and items it defines', () => {
      const npcIds = new Set(NPCS.map((n) => n.id));
      const itemIds = new Set(ITEMS.map((i) => i.id));
      for (const tile of map.tiles.flat())
        if (tile.npcSpawn) expect(npcIds).toContain(tile.npcSpawn);
      for (const drop of NPCS.flatMap((n) => n.itemsToDrop ?? []))
        expect(itemIds).toContain(drop.itemId);
    });

    // Props are scattered by a seeded roll, so a change to the seed or the
    // layout could wall a spawn in without anyone looking at the map.
    it('lets a player walk from the respawn point to every npc', () => {
      const seen = new Set<string>();
      const queue = [[RESPAWN.col, RESPAWN.row]];
      while (queue.length) {
        const [col, row] = queue.pop()!;
        const key = `${col},${row}`;
        const tile = map.tiles[row!]?.[col!];
        if (!tile || tile.blocked || seen.has(key)) continue;
        seen.add(key);
        queue.push(
          [col! + 1, row!],
          [col! - 1, row!],
          [col!, row! + 1],
          [col!, row! - 1],
        );
      }
      map.tiles.forEach((line, row) =>
        line.forEach((tile, col) => {
          if (tile.npcSpawn) expect(seen).toContain(`${col},${row}`);
        }),
      );
    });
  },
);

describe('writeGame', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a game.json the boot accepts, named after the folder', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-game-'));
    const game = path.join(dir, 'my-game');
    writeGame(game);
    const config = loadGameConfig(game);
    expect(config.brand.name).toBe('My Game');
    expect(config.world.startMapId).toBe(buildMap().id);
    for (const sheet of [
      'tiles',
      'sprites',
      'items',
      'spells',
      'arrows',
      'attackeffect',
    ])
      expect(fs.existsSync(path.join(game, 'assets', `${sheet}.png`))).toBe(
        true,
      );
  });

  it('switches every official module off', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-game-'));
    writeGame(dir);
    const { modules } = loadGameConfig(dir);
    expect(Object.keys(modules)).toContain('quest');
    for (const entry of Object.values(modules))
      expect(entry.enabled).toBe(false);
  });

  it('takes the name the login screen shows, when given one', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-game-'));
    writeGame(dir, 'Meadow Quest');
    expect(loadGameConfig(dir).brand.name).toBe('Meadow Quest');
  });

  it('draws the map isometric when asked', () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'new-game-'));
    writeGame(dir, undefined, 'isometric');
    const [map] = JSON.parse(
      fs.readFileSync(path.join(dir, 'content', 'maps.json'), 'utf-8'),
    );
    expect(map.orientation).toBe('isometric');
  });
});
