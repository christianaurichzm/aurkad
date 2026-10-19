// @ts-check
// The night over Gravewatch, and the siege an operator calls down on it.
//
// Every night the lighting module's dark falls, and the client is told where
// the lamps stand (found on the live map, again on every map change) to draw
// their light from `lightSheet`.
//
// The siege runs while the live-ops flag `siege` is on:
//
//     flag siege true for 20            starts now, ends in 20 minutes
//     flag siege true at 21:00 for 30   tonight at nine
//     flag siege clear                  calls it off
//
// Every `waveSeconds` the dead climb out by the two gates, scaled by players
// on the map and capped at `maxAlive`, until wave `bossWave` brings the
// Ossuary Lord. When the flag ends the rest crumble, and the players are paid
// for each wave they held.

/** @typedef {{ name: string, maxHealth: number, attack: number, experienceValue: number, sprite: number }} Kind */
const cfg = /** @type {{
  mapId: string, ambient: number, siegeAmbient: number,
  lamps: Record<string, [number, number, number, number, number, number]>,
  lightSheet: string,
  spawnPoints: [number, number][], waveSeconds: number, base: number, perPlayer: number,
  maxAlive: number, bossWave: number, gold: number, kinds: Record<string, Kind>,
}} */ (config);

// Which kinds rise, by wave: the early waves are mostly Risen.
const MIX = [
  ['risen', 'risen', 'risen', 'grave-robber'],
  ['risen', 'risen', 'bone-knight', 'grave-robber'],
  ['risen', 'bone-knight', 'bone-knight', 'warlock', 'grave-robber'],
];
const SIGHT = 60; // tiles: the whole map
const DAWN_XP_PER_WAVE = 40;

let running = false;
let wave = 0;
/** @type {number | undefined} */
let timer;
/** @type {Map<string, RuntimeNpc>} */
const horde = new Map();

const onMap = () => getPlayers().filter((p) => p.mapId === cfg.mapId);

function lights() {
  const size = getMapSize(cfg.mapId);
  const found = [];
  for (let row = 0; row < (size?.rows ?? 0); row++) {
    for (let col = 0; col < (size?.cols ?? 0); col++) {
      const mask = getMapTile(cfg.mapId, col, row)?.maskIndex;
      const rect = mask === undefined ? undefined : cfg.lamps[mask];
      if (rect) {
        found.push({
          x: (col + 0.5) * TILE_SIZE,
          y: (row + 0.5) * TILE_SIZE,
          rect,
        });
      }
    }
  }
  return found;
}

function night(player, lit = lights()) {
  sendEvent(player, 'lighting', {
    ambient: running ? cfg.siegeAmbient : cfg.ambient,
    lights: [],
    // A player lantern only once the siege turns the night black; before that
    // the lamps light the churchyard.
    playerLight: running,
  });
  sendEvent(player, 'gravewatch:lamps', { sheet: cfg.lightSheet, lamps: lit });
}

function raise(kindName) {
  const kind = cfg.kinds[kindName];
  const at = randomPick(cfg.spawnPoints);
  if (!kind || !at) return;
  const npc = spawnNpc({
    mapId: cfg.mapId,
    col: at[0],
    row: at[1],
    ...kind,
    behavior: 'aggressive',
    sight: SIGHT,
    leash: 0,
    solid: true,
  });
  if (npc) horde.set(npc.id, npc);
}

function nextWave() {
  wave += 1;
  const players = onMap().length;
  const room = cfg.maxAlive - horde.size;
  const count = Math.min(room, cfg.base + cfg.perPlayer * players + wave);
  const mix =
    MIX[Math.min(MIX.length - 1, Math.floor((wave - 1) / 2))] ?? MIX[0];
  for (let i = 0; i < count; i++) raise(randomPick(mix) ?? 'risen');
  if (wave === cfg.bossWave) {
    raise('ossuary-lord');
    broadcastMessage('The trees part. The Ossuary Lord walks out of the dark.');
  } else if (count > 0) {
    broadcastMessage(
      `Wave ${wave}: ${count} dead claw out of the earth by the gates.`,
    );
  }
}

function begin() {
  if (running) return;
  running = true;
  wave = 0;
  broadcastMessage(
    'The bell of Gravewatch tolls. The dead are rising - hold the churchyard until dawn!',
  );
  const lit = lights();
  for (const player of onMap()) night(player, lit);
  sendMapEvent(cfg.mapId, 'gravewatch:siege', { running: true });
  nextWave();
  timer = every(msToTicks(cfg.waveSeconds * 1000), nextWave);
}

function end() {
  if (!running) return;
  running = false;
  if (timer !== undefined) cancel(timer);
  timer = undefined;
  for (const npc of horde.values()) despawnNpc(npc);
  horde.clear();
  const survivors = onMap();
  const lit = lights();
  for (const player of survivors) {
    night(player, lit);
    if (wave > 0) giveExperience(player, DAWN_XP_PER_WAVE * wave);
  }
  sendMapEvent(cfg.mapId, 'gravewatch:siege', { running: false });
  broadcastMessage(
    wave > 0
      ? `Dawn. The dead crumble where they stand. The churchyard held for ${wave} waves.`
      : 'The bell falls silent.',
  );
}

// A raised corpse has no spawn tile to come back to: it pays out and goes.
on('npcDeath', ({ npc, killer }) => {
  if (!horde.has(npc.id)) return;
  horde.delete(npc.id);
  giveItem(killer, cfg.gold, 1 + randomInt(3));
  despawnNpc(npc);
});

on('liveOpsFlag', ({ name, active, value }) => {
  if (name !== 'siege') return;
  if (active && value !== false) begin();
  else end();
});

// Sent when the client asks rather than on `playerJoin`: that hook fires on
// the HTTP login, before there is a socket to send on.
on('customAction', ({ player, channel }) => {
  if (channel !== 'gravewatch:hello') return;
  night(player);
  if (running) {
    sendEvent(player, 'gravewatch:siege', { running: true });
    sendMessage(player, `The siege is on - wave ${wave}. Get to the gates.`);
  }
});

on('mapChange', ({ mapId }) => {
  if (mapId !== cfg.mapId) return;
  const lit = lights();
  for (const player of onMap()) night(player, lit);
});

// A restart in the middle of a siege picks it back up: the flag is the truth.
if (flags.enabled('siege')) begin();
