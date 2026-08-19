// @ts-check
// Social module: friends and ignore lists. Friends are one-way, since the
// online list is public anyway. Both live in `player.data`, read only while
// the owner is online.
//
// Chat delivery is core, so ignores take effect through setChatIgnored.

i18n({
  pt: {
    'Player not found.': 'Jogador não encontrado.',
    'You cannot add yourself.': 'Você não pode se adicionar.',
    '{player} is already on your friends list.':
      '{player} já está na sua lista de amigos.',
    'Your friends list is full.': 'Sua lista de amigos está cheia.',
    'Added {player} to your friends.': '{player} foi adicionado aos amigos.',
    '{player} is not on your friends list.':
      '{player} não está na sua lista de amigos.',
    'Removed {player} from your friends.':
      '{player} saiu da sua lista de amigos.',
    'Friends ({online} online): {names}': 'Amigos ({online} online): {names}',
    'You have no friends listed.': 'Sua lista de amigos está vazia.',
    'You cannot ignore yourself.': 'Você não pode ignorar a si mesmo.',
    'Your ignore list is full.': 'Sua lista de ignorados está cheia.',
    'You are now ignoring {player}.': 'Você está ignorando {player}.',
    '{player} is not on your ignore list.':
      '{player} não está na sua lista de ignorados.',
    'You are no longer ignoring {player}.':
      'Você não está mais ignorando {player}.',
    'Ignoring: {names}': 'Ignorando: {names}',
    'You are not ignoring anyone.': 'Você não está ignorando ninguém.',
    'Could not save your list.': 'Não foi possível salvar sua lista.',
    '{player} logged in.': '{player} entrou.',
    '{player} logged out.': '{player} saiu.',
    'Social commands must be used in-game.':
      'Os comandos sociais só funcionam dentro do jogo.',
    'Usage: /friend add|remove|list [player]':
      'Uso: /friend add|remove|list [jogador]',
    'Usage: /ignore add|remove|list [player]':
      'Uso: /ignore add|remove|list [jogador]',
  },
});

const maxFriends = Math.max(1, Number((config && config.maxFriends) || 100));
const maxIgnored = Math.max(1, Number((config && config.maxIgnored) || 100));
const announceLogin = (config && config.announceLogin) !== false;

const FRIENDS = 'friends';
const IGNORED = 'ignored';

/** @param {PlayerServer} player @param {string} key */
const listOf = (player, key) => {
  const stored = getPlayerData(player, key);
  return Array.isArray(stored)
    ? stored.filter((n) => typeof n === 'string')
    : [];
};

const friendsOf = (player) => listOf(player, FRIENDS);
const ignoredBy = (player) => listOf(player, IGNORED);

/** Case-insensitive, because a name typed into chat rarely matches its case. */
const indexOfName = (list, name) =>
  list.findIndex((n) => n.toLowerCase() === name.toLowerCase());

/**
 * @param player who to tell
 * @param gone a player who is leaving, still registered when playerLeave
 *   runs and so still "online" to getPlayer.
 */
function push(player, gone) {
  const friends = friendsOf(player).map((name) => ({
    name,
    online: name !== gone && !!getPlayer(name),
  }));
  sendEvent(player, 'social:update', {
    friends,
    ignored: ignoredBy(player),
    maxFriends,
    maxIgnored,
  });
}

/** The core only knows the list while its owner is online. */
function applyIgnores(player) {
  setChatIgnored(player, ignoredBy(player));
}

function addFriend(player, rawName) {
  const target = getPlayer(String(rawName || ''));
  if (!target) return 'Player not found.';
  if (target.name === player.name) return 'You cannot add yourself.';

  const friends = friendsOf(player);
  if (indexOfName(friends, target.name) >= 0)
    return t(player, '{player} is already on your friends list.', {
      player: target.name,
    });
  if (friends.length >= maxFriends) return 'Your friends list is full.';

  friends.push(target.name);
  if (!setPlayerData(player, FRIENDS, friends))
    return 'Could not save your list.';
  push(player);
  return t(player, 'Added {player} to your friends.', { player: target.name });
}

function removeFriend(player, rawName) {
  const name = String(rawName || '');
  const friends = friendsOf(player);
  const at = indexOfName(friends, name);
  if (at < 0)
    return t(player, '{player} is not on your friends list.', { player: name });

  const [removed] = friends.splice(at, 1);
  if (!setPlayerData(player, FRIENDS, friends))
    return 'Could not save your list.';
  push(player);
  return t(player, 'Removed {player} from your friends.', { player: removed });
}

function addIgnored(player, rawName) {
  const name = String(rawName || '');
  // An ignore does not need its target online, often someone who just left.
  const target = getPlayer(name);
  const stored = target ? target.name : name;
  if (!stored) return 'Player not found.';
  if (stored.toLowerCase() === player.name.toLowerCase())
    return 'You cannot ignore yourself.';

  const ignored = ignoredBy(player);
  if (indexOfName(ignored, stored) >= 0)
    return t(player, 'You are now ignoring {player}.', { player: stored });
  if (ignored.length >= maxIgnored) return 'Your ignore list is full.';

  ignored.push(stored);
  if (!setPlayerData(player, IGNORED, ignored))
    return 'Could not save your list.';
  applyIgnores(player);
  push(player);
  return t(player, 'You are now ignoring {player}.', { player: stored });
}

function removeIgnored(player, rawName) {
  const name = String(rawName || '');
  const ignored = ignoredBy(player);
  const at = indexOfName(ignored, name);
  if (at < 0)
    return t(player, '{player} is not on your ignore list.', { player: name });

  const [removed] = ignored.splice(at, 1);
  if (!setPlayerData(player, IGNORED, ignored))
    return 'Could not save your list.';
  applyIgnores(player);
  push(player);
  return t(player, 'You are no longer ignoring {player}.', { player: removed });
}

/** Everyone online who lists this player as a friend. */
function watchersOf(player) {
  return getPlayers().filter(
    (other) =>
      other.name !== player.name &&
      indexOfName(friendsOf(other), player.name) >= 0,
  );
}

command(
  'friend',
  { description: 'Friends: /friend add|remove|list [player]' },
  ({ player, args, reply }) => {
    if (!player) return reply('Social commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'add') return reply(addFriend(player, args[1]));
    if (sub === 'remove') return reply(removeFriend(player, args[1]));
    if (sub === 'list') {
      const friends = friendsOf(player);
      if (friends.length === 0) return reply('You have no friends listed.');
      return reply(
        t(player, 'Friends ({online} online): {names}', {
          online: friends.filter((name) => !!getPlayer(name)).length,
          names: friends.join(', '),
        }),
      );
    }
    reply('Usage: /friend add|remove|list [player]');
  },
);

command(
  'ignore',
  { description: 'Ignore list: /ignore add|remove|list [player]' },
  ({ player, args, reply }) => {
    if (!player) return reply('Social commands must be used in-game.');
    const sub = String(args[0] || '').toLowerCase();
    if (sub === 'add') return reply(addIgnored(player, args[1]));
    if (sub === 'remove') return reply(removeIgnored(player, args[1]));
    if (sub === 'list') {
      const ignored = ignoredBy(player);
      if (ignored.length === 0) return reply('You are not ignoring anyone.');
      return reply(
        t(player, 'Ignoring: {names}', { names: ignored.join(', ') }),
      );
    }
    reply('Usage: /ignore add|remove|list [player]');
  },
);

on('customAction', ({ player, channel, payload }) => {
  const data = /** @type {any} */ (payload);
  const name = data && data.name;
  if (channel === 'social:friendAdd') addFriend(player, name);
  else if (channel === 'social:friendRemove') removeFriend(player, name);
  else if (channel === 'social:ignoreAdd') addIgnored(player, name);
  else if (channel === 'social:ignoreRemove') removeIgnored(player, name);
  else if (channel === 'social:request') push(player);
});

on('playerJoin', ({ player }) => {
  // playerJoin fires on the HTTP login before the socket exists, so the
  // client asks on `social:request` once connected.
  applyIgnores(player);
  if (!announceLogin) return;
  for (const watcher of watchersOf(player)) {
    sendMessage(
      watcher,
      t(watcher, '{player} logged in.', { player: player.name }),
    );
    push(watcher);
  }
});

on('playerLeave', ({ player }) => {
  // The core holds the ignore list only while its owner is connected; the
  // copy in player.data is restored on join.
  setChatIgnored(player, []);
  if (!announceLogin) return;
  for (const watcher of watchersOf(player)) {
    sendMessage(
      watcher,
      t(watcher, '{player} logged out.', { player: player.name }),
    );
    push(watcher, player.name);
  }
});

provide('social', {
  friends: friendsOf,
  ignored: ignoredBy,
  isFriend: (player, name) => indexOfName(friendsOf(player), name) >= 0,
  isIgnored: (player, name) => indexOfName(ignoredBy(player), name) >= 0,
  addFriend,
  removeFriend,
  addIgnored,
  removeIgnored,
});

log(
  `Social module ready (maxFriends=${maxFriends}, maxIgnored=${maxIgnored}).`,
);
