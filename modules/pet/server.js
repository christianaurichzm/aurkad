// @ts-check
// Pet module: /pet summons a follower that walks like an npc, fights nearby
// enemies for its owner and follows across maps, all on the script API.

i18n({
  pt: {
    'In-game only.': 'Só dentro do jogo.',
    'Pet dismissed.': 'Bicho dispensado.',
    'Pet summoned.': 'Bicho invocado.',
  },
});

const petSprite = Number((config && config.sprite) || 0);
const petAttack = Number((config && config.attack) || 5);
const aggroRadius = Number((config && config.aggroRadius) || 120);
const cadence = Number((config && config.moveEveryTicks) || 25);

const pets = {}; // ownerName -> npc

function spawnPet(player) {
  // A step behind and to the side, so the two names do not overlap.
  const col = Math.round(player.position.x / TILE_SIZE) + 1;
  const row = Math.round(player.position.y / TILE_SIZE) + 1;
  const pet = spawnNpc({
    mapId: player.mapId,
    col,
    row,
    name: player.name + "'s Pet",
    sprite: petSprite,
    maxHealth: 40,
    behavior: 'friendly', // passive AI (this module drives it); renders green
  });
  if (pet) pets[player.name] = pet;
  return pet;
}

function dismiss(name) {
  if (pets[name]) {
    despawnNpc(pets[name]);
    delete pets[name];
  }
}

const isEnemy = (n) => n.behavior === 'aggressive' || n.behavior === 'hostile';
const chebyshev = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

function face(npc, target) {
  const dx = target.position.x - npc.position.x;
  const dy = target.position.y - npc.position.y;
  if (Math.abs(dx) > Math.abs(dy))
    npc.direction = dx > 0 ? 2 : 1; // Right / Left
  else npc.direction = dy > 0 ? 0 : 3; // Down / Up
}

command(
  'pet',
  { description: 'Summon or dismiss your pet' },
  ({ player, reply }) => {
    if (!player) return reply('In-game only.');
    if (pets[player.name]) {
      dismiss(player.name);
      return reply('Pet dismissed.');
    }
    spawnPet(player);
    reply('Pet summoned.');
  },
);

on('playerLeave', ({ player }) => dismiss(player.name));

on('tick', ({ tick }) => {
  if (tick % cadence !== 0) return;

  for (const name in pets) {
    let pet = pets[name];
    const owner = getPlayer(name);
    if (!owner) {
      dismiss(name);
      continue;
    }

    // Keep up across map changes.
    if (pet.mapId !== owner.mapId) {
      dismiss(name);
      pet = spawnPet(owner);
      if (!pet) continue;
    }

    // Nearest enemy around the pet.
    let target = null;
    let best = Infinity;
    for (const e of getNearbyNpcs(
      pet.mapId,
      pet.position.x,
      pet.position.y,
      aggroRadius,
    )) {
      if (!isEnemy(e)) continue;
      const d = chebyshev(pet.position, e.position);
      if (d < best) {
        best = d;
        target = e;
      }
    }

    if (target && best <= TILE_SIZE) {
      face(pet, target);
      pet.action = 'Attack';
      dealDamage(target, petAttack, owner); // owner gets the kill credit
    } else if (target) {
      moveNpcToward(pet, target.position.x, target.position.y);
    } else if (chebyshev(pet.position, owner.position) > TILE_SIZE) {
      moveNpcToward(pet, owner.position.x, owner.position.y);
    } else {
      pet.action = 'Idle';
    }
  }
});

log('Pet module ready.');
