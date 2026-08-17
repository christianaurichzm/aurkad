/**
 * Every string a player sees. Other languages are typed against this table,
 * so a missing translation is a compile error. `{name}` placeholders are
 * filled by `t(key, { name })`.
 */
export const en = {
  // Auth
  'auth.username': 'Username',
  'auth.password': 'Password',
  'auth.login': 'Login',
  'auth.register': 'Register',
  'auth.chooseUsername': 'Choose a username',
  'auth.choosePassword': 'Choose a password',
  'auth.noAccount': "Don't have an account?",
  'auth.hasAccount': 'Already have an account?',
  'auth.accountCreated': 'Account created! Redirecting to login…',
  'auth.loggingIn': 'Logging in…',
  'auth.registering': 'Creating account…',

  // HUD
  'hud.level': 'Level {level}',
  'hud.hp': 'HP',
  'hud.xp': 'XP {current}/{max}',
  'hud.attackCooldown': 'Attack cooldown',
  'hud.reconnecting': 'Reconnecting…',
  'hud.disconnected': 'Disconnected',

  // Actions menu
  'actions.title': 'Actions',
  'actions.inventory': 'Inventory',
  'actions.attributes': 'Attributes',
  'actions.onlinePlayers': 'Online players',
  'actions.settings': 'Settings',

  // Inventory and equipment
  'inventory.title': 'Inventory',
  'inventory.empty': 'Nothing here yet.',
  'inventory.use': 'Use',
  'inventory.equip': 'Equip',
  'inventory.unequip': 'Unequip',
  'inventory.drop': 'Drop',
  'inventory.dropAmount': 'How many?',
  'inventory.bound': 'Bound - cannot be dropped or traded',
  'inventory.capacity': '{used}/{max} slots',
  'equipment.title': 'Equipment',
  'equipment.empty': 'Nothing equipped.',

  // Attributes
  'attributes.title': 'Attributes',
  'attributes.strength': 'Strength',
  'attributes.defense': 'Defense',
  'attributes.agility': 'Agility',
  'attributes.vitality': 'Vitality',
  'attributes.unspent': 'Points to spend: {points}',
  'attributes.confirm': 'Confirm',

  // Shop
  'shop.title': 'Shop',
  'shop.buy': 'Buy',
  'shop.price': 'Price: {price}',
  'shop.close': 'Close',
  'shop.cannotAfford': 'Not enough money.',

  // Online players
  'online.title': 'Online players',
  'online.count': '{count} online',
  'online.empty': 'Nobody else is here.',

  // Chat
  'chat.placeholder': 'Type a message…',
  'chat.send': 'Send',
  'chat.scopeGlobal': 'Global',
  'chat.scopeMap': 'Map',
  'chat.scopePlayer': 'Whisper',

  // Settings
  'settings.title': 'Settings',
  'settings.music': 'Music',
  'settings.effects': 'Effects',
  'settings.mute': 'Mute everything',
  'settings.language': 'Language',
  'settings.close': 'Close',

  // Quests
  'quest.title': 'Quests',
  'quest.empty': 'No quests yet.',
  'quest.progress': '{current}/{target}',
  'quest.complete': 'Complete',

  // Shared
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.loading': 'Loading…',
  'common.error': 'Something went wrong.',

  // Inventory, stats and other player screens
  'inventory.bagEmpty': 'Bag is empty',
  'inventory.dropQuantity': 'Drop quantity',
  'inventory.offerInTrade': 'Offer in trade',
  'stats.level': 'Level',
  'stats.attack': 'Attack',
  'stats.strength': 'Strength',
  'stats.defense': 'Defense',
  'stats.agility': 'Agility',
  'stats.vitality': 'Vitality',
  'stats.health': 'Health',
  'stats.speed': 'Speed',
  'shop.notFound': 'Shop not found.',
  'online.loading': 'Loading players…',
  'online.none': 'No players online',
} as const;

export type TranslationKey = keyof typeof en;
