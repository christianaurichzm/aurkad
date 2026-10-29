// @ts-check
// Asks for the night (server.js answers with the lamps), says so on screen
// when the siege starts or ends, and shows a newcomer how to play.
engine.i18n({
  pt: {
    'The dead are rising': 'Os mortos se erguem',
    Siege: 'Cerco',
    'Hold both gates until dawn.': 'Segure os dois portões até o amanhecer.',
    Dawn: 'Amanhecer',
    'The dead crumble where they stand.': 'Os mortos se desfazem onde estão.',
    Help: 'Ajuda',
    'How to play': 'Como jogar',
    Moving: 'Movimento',
    'Talking and fighting': 'Conversa e combate',
    Windows: 'Janelas',
    Arrows: 'Setas',
    'Walk. The map is turned: Up goes northeast, Right southeast, Down southwest, Left northwest.':
      'Andar. O mapa está girado: Cima vai para nordeste, Direita para sudeste, Baixo para sudoeste, Esquerda para noroeste.',
    Click: 'Clique',
    'Walk there, or up to whoever you click. Click them again to attack or talk.':
      'Andar até lá, ou até quem você clicou. Clique de novo para atacar ou conversar.',
    Tap: 'Toque',
    'Walk there, or up to whoever you tap. Tap them again to attack or talk.':
      'Andar até lá, ou até quem você tocou. Toque de novo para atacar ou conversar.',
    Run: 'Correr',
    Interact: 'Interagir',
    Attack: 'Atacar',
    'Hold to run.': 'Segure para correr.',
    'Talk to whoever you face. Agathe and Brand have quests. To trade with Hobb, stand on the planks by his table.':
      'Falar com quem está à sua frente. Agathe e Brand têm missões. Para negociar com Hobb, fique nas tábuas junto à mesa dele.',
    'Attack whoever you face. The dead roam outside the fence.':
      'Atacar quem está à sua frente. Os mortos vagam do lado de fora da cerca.',
    'Bag, attributes, quests, who is online.':
      'Bolsa, atributos, missões, quem está online.',
    'Bag, attributes, quests, who is online, and this help.':
      'Bolsa, atributos, missões, quem está online e esta ajuda.',
    'This help. Every window is in the Actions menu too.':
      'Esta ajuda. Todas as janelas também estão no menu Ações.',
    'Creator tools': 'Ferramentas de criação',
    'Map editor.': 'Editor de mapa.',
    'In the chat: the dead rise for ten minutes.':
      'No chat: os mortos se erguem por dez minutos.',
    'Calls the siege off.': 'Encerra o cerco.',
  },
  es: {
    'The dead are rising': 'Los muertos se levantan',
    Siege: 'Asedio',
    'Hold both gates until dawn.': 'Resiste en las dos puertas hasta el alba.',
    Dawn: 'Alba',
    'The dead crumble where they stand.':
      'Los muertos se deshacen donde están.',
    Help: 'Ayuda',
    'How to play': 'Cómo jugar',
    Moving: 'Movimiento',
    'Talking and fighting': 'Conversar y luchar',
    Windows: 'Ventanas',
    Arrows: 'Flechas',
    'Walk. The map is turned: Up goes northeast, Right southeast, Down southwest, Left northwest.':
      'Caminar. El mapa está girado: Arriba va al noreste, Derecha al sureste, Abajo al suroeste, Izquierda al noroeste.',
    Click: 'Clic',
    'Walk there, or up to whoever you click. Click them again to attack or talk.':
      'Caminar hasta allí, o hasta quien hayas hecho clic. Haz clic de nuevo para atacar o hablar.',
    Tap: 'Toque',
    'Walk there, or up to whoever you tap. Tap them again to attack or talk.':
      'Caminar hasta allí, o hasta quien hayas tocado. Toca de nuevo para atacar o hablar.',
    Run: 'Correr',
    Interact: 'Interactuar',
    Attack: 'Atacar',
    Menu: 'Menú',
    'Hold to run.': 'Mantén pulsado para correr.',
    'Talk to whoever you face. Agathe and Brand have quests. To trade with Hobb, stand on the planks by his table.':
      'Hablar con quien tienes delante. Agathe y Brand tienen misiones. Para comerciar con Hobb, ponte en las tablas junto a su mesa.',
    'Attack whoever you face. The dead roam outside the fence.':
      'Atacar a quien tienes delante. Los muertos vagan fuera de la valla.',
    'Bag, attributes, quests, who is online.':
      'Bolsa, atributos, misiones, quién está conectado.',
    'Bag, attributes, quests, who is online, and this help.':
      'Bolsa, atributos, misiones, quién está conectado y esta ayuda.',
    'This help. Every window is in the Actions menu too.':
      'Esta ayuda. Todas las ventanas están también en el menú Acciones.',
    'Creator tools': 'Herramientas de creación',
    'Map editor.': 'Editor de mapa.',
    'In the chat: the dead rise for ten minutes.':
      'En el chat: los muertos se levantan durante diez minutos.',
    'Calls the siege off.': 'Termina el asedio.',
  },
});

engine.onServerEvent('gravewatch:siege', (payload) => {
  if (payload?.running) {
    engine.ui.notice(engine.t('The dead are rising'), {
      tone: 'danger',
      label: engine.t('Siege'),
      detail: engine.t('Hold both gates until dawn.'),
      ms: 6000,
    });
  } else {
    engine.ui.notice(engine.t('Dawn'), {
      tone: 'highlight',
      detail: engine.t('The dead crumble where they stand.'),
      ms: 5000,
    });
  }
});
engine.sendServerEvent('gravewatch:hello');

// How to play: opened the first time a character comes in, and again from H
// or its tile in the Actions menu. A touch screen has no keys, so there each
// row names the on-screen control instead, and a row without one is left
// out. The creator rows need ADMIN, as the map editor and `flag` do.
const SECTIONS = [
  {
    title: 'Moving',
    rows: [
      {
        keys: ['Arrows'],
        touch: 'Arrows',
        text: 'Walk. The map is turned: Up goes northeast, Right southeast, Down southwest, Left northwest.',
      },
      {
        keys: ['Click'],
        touch: 'Tap',
        text: 'Walk there, or up to whoever you click. Click them again to attack or talk.',
        touchText:
          'Walk there, or up to whoever you tap. Tap them again to attack or talk.',
      },
      { keys: ['Shift'], touch: 'Run', text: 'Hold to run.' },
    ],
  },
  {
    title: 'Talking and fighting',
    rows: [
      {
        keys: ['F'],
        touch: 'Interact',
        text: 'Talk to whoever you face. Agathe and Brand have quests. To trade with Hobb, stand on the planks by his table.',
      },
      {
        keys: ['Ctrl'],
        touch: 'Attack',
        text: 'Attack whoever you face. The dead roam outside the fence.',
      },
    ],
  },
  {
    title: 'Windows',
    rows: [
      {
        keys: ['I', 'V', 'Q', 'O'],
        touch: 'Menu',
        text: 'Bag, attributes, quests, who is online.',
        touchText: 'Bag, attributes, quests, who is online, and this help.',
      },
      {
        keys: ['H'],
        text: 'This help. Every window is in the Actions menu too.',
      },
    ],
  },
];
const CREATOR = {
  title: 'Creator tools',
  rows: [
    { keys: ['Z'], text: 'Map editor.' },
    {
      command: '/flag siege true for 10',
      text: 'In the chat: the dead rise for ten minutes.',
    },
    { command: '/flag siege clear', text: 'Calls the siege off.' },
  ],
};
const ADMIN = 2;

// One grid for every section, so the descriptions line up under each other.
const STYLE = {
  grid: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    gap: '12px 16px',
    alignItems: 'baseline',
  },
  heading: {
    gridColumn: '1 / -1',
    margin: '10px 0 0',
    paddingBottom: 6,
    borderBottom: '1px solid var(--color-border)',
    color: 'var(--color-accent)',
    fontSize: 13,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  keys: { display: 'flex', gap: 4 },
  key: { minWidth: 20, padding: '1px 6px', fontSize: 12, textAlign: 'center' },
  command: {
    marginRight: 10,
    padding: '1px 6px',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: 'var(--color-accent)',
    background: 'var(--color-surface-muted)',
  },
  text: { margin: 0, lineHeight: 1.5 },
  commandLine: { gridColumn: '1 / -1', margin: 0, lineHeight: 1.8 },
};

const h = React.createElement;
let helpShown = false;
const toggleHelp = () => {
  helpShown = !helpShown;
  engine.render(helpShown && h(Help));
};

function Help() {
  const t = engine.useT();
  // The query the stylesheet hides key badges (.action-key) under.
  const touch = window.matchMedia('(pointer: coarse)').matches;
  const label = (row) => {
    if (touch) return h('strong', null, t(row.touch));
    return row.keys.map((k) =>
      h('kbd', { key: k, className: 'action-key', style: STYLE.key }, t(k)),
    );
  };
  // A command spans both columns: in the first it would push every
  // description aside.
  const line = (row) =>
    row.command
      ? [
          h(
            'p',
            { key: row.text, style: STYLE.commandLine },
            h('code', { style: STYLE.command }, row.command),
            t(row.text),
          ),
        ]
      : [
          h('div', { key: `${row.text}:keys`, style: STYLE.keys }, label(row)),
          h(
            'p',
            { key: row.text, style: STYLE.text },
            t((touch && row.touchText) || row.text),
          ),
        ];
  const section = ({ title, rows }, i) => {
    const shown = rows.filter((row) => !touch || row.touch || row.command);
    if (!shown.length) return [];
    return [
      h(
        'h3',
        {
          key: title,
          style: i ? STYLE.heading : { ...STYLE.heading, margin: 0 },
        },
        t(title),
      ),
      ...shown.flatMap(line),
    ];
  };
  const creator = (engine.getPlayer()?.access ?? 0) >= ADMIN;
  const sections = creator ? [...SECTIONS, CREATOR] : SECTIONS;
  return h(
    engine.ui.Window,
    { title: t('How to play'), width: 'wide', onClose: toggleHelp },
    h('div', { style: STYLE.grid }, ...sections.flatMap(section)),
  );
}

engine.ui.actionButton('Help', toggleHelp, 'h', undefined, 130);
try {
  const seen = `gravewatch.help.${engine.getPlayer()?.name}`;
  if (!localStorage.getItem(seen)) {
    localStorage.setItem(seen, '1');
    toggleHelp();
  }
} catch {
  // Storage disabled (private mode): the help stays one H away.
}

// The lamps' light over the night's dark. build.py renders what each lamp
// throws and server.js says where each stands. It goes on the fringe canvas
// with the dark, so the names drawn after the scene stay unlit.
/** @type {{ x: number, y: number, rect: number[] }[]} */
let lamps = [];
/** @type {HTMLImageElement | null} */
let lightSheet = null;
const lightCanvas = document.createElement('canvas');

engine.onServerEvent('gravewatch:lamps', (payload) => {
  if (!payload || !Array.isArray(payload.lamps)) return;
  lamps = payload.lamps;
  const src = `/theme/${payload.sheet}`;
  if (!lightSheet?.src.endsWith(src)) {
    lightSheet = new Image();
    lightSheet.src = src;
  }
});

// Summed on a buffer first: `lighter` straight onto the fringe would add
// each light's alpha to the dark's too. Drawn over the mist, so the mist
// round a lamp is lit.
engine.registerOverlay((ctx, cam) => {
  if (!lightSheet?.naturalWidth) return;
  if (
    lightCanvas.width !== ctx.canvas.width ||
    lightCanvas.height !== ctx.canvas.height
  ) {
    lightCanvas.width = ctx.canvas.width;
    lightCanvas.height = ctx.canvas.height;
  }
  const l = lightCanvas.getContext('2d');
  if (!l) return;
  const scale = ctx.canvas.width / engine.GAME_WIDTH;
  l.setTransform(scale, 0, 0, scale, 0, 0);
  l.clearRect(0, 0, engine.GAME_WIDTH, engine.GAME_HEIGHT);
  // The sheet is at the engine's scale: one cell across is half a tile wide.
  const o = engine.worldToScreen(0, 0);
  const k =
    (engine.worldToScreen(engine.TILE_SIZE, 0).x - o.x) /
    (engine.TILE_SIZE / 2);
  // Two lamps side by side light the ground between them twice.
  l.globalCompositeOperation = 'lighter';
  for (const { x, y, rect } of lamps) {
    const [sx, sy, w, h, cx, cy] = rect;
    const at = engine.worldToScreen(x, y);
    l.drawImage(
      lightSheet,
      sx,
      sy,
      w,
      h,
      at.x - cx * k,
      at.y - cy * k,
      w * k,
      h * k,
    );
  }
  l.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.drawImage(lightCanvas, 0, 0, engine.GAME_WIDTH, engine.GAME_HEIGHT);
  ctx.restore();
}, engine.OverlayLayer.scene + 2);

// Mist: two sheets of wisps drifting at different speeds, so the pattern
// never repeats in step. Drawn over the dark since moonlight lights it, and
// thinned round the player and the lamps.
const FOG = {
  size: 800,
  wisps: 9,
  colour: '132,150,186',
  clear: 400,
  clearLamp: 260,
};
const sheets = [
  { canvas: fogSheet(0.3), vx: 9, vy: 2 },
  { canvas: fogSheet(0.18), vx: -5, vy: 3 },
];

/** Wisps flattened into ground banks, wrapped so the sheet tiles. */
function fogSheet(alpha) {
  const sheet = document.createElement('canvas');
  sheet.width = sheet.height = FOG.size;
  const g = sheet.getContext('2d');
  if (!g) return sheet;
  for (let i = 0; i < FOG.wisps; i++) {
    const x = Math.random() * FOG.size;
    const y = Math.random() * FOG.size;
    const r = 150 + Math.random() * 220;
    const a = alpha * (0.4 + Math.random() * 0.6);
    for (const dx of [-FOG.size, 0, FOG.size]) {
      for (const dy of [-FOG.size, 0, FOG.size]) {
        g.setTransform(1, 0, 0, 0.38, x + dx, y + dy);
        const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
        grad.addColorStop(0, `rgba(${FOG.colour},${a})`);
        grad.addColorStop(1, `rgba(${FOG.colour},0)`);
        g.fillStyle = grad;
        g.fillRect(-r, -r, r * 2, r * 2);
      }
    }
  }
  return sheet;
}

/** @type {HTMLCanvasElement | null} */
let fog = null;

engine.registerOverlay((ctx, cam) => {
  const width = engine.GAME_WIDTH;
  const height = engine.GAME_HEIGHT;
  const scale = ctx.canvas.width / width;
  fog ??= document.createElement('canvas');
  if (fog.width !== ctx.canvas.width || fog.height !== ctx.canvas.height) {
    fog.width = ctx.canvas.width;
    fog.height = ctx.canvas.height;
  }
  const b = fog.getContext('2d');
  if (!b) return;
  b.setTransform(scale, 0, 0, scale, 0, 0);
  b.clearRect(0, 0, width, height);
  b.globalCompositeOperation = 'source-over';
  const t = performance.now() / 1000;
  const wrap = (v) => ((v % FOG.size) + FOG.size) % FOG.size;
  // Pinned to the world: the camera moving slides the mist like the ground.
  for (const { canvas, vx, vy } of sheets) {
    const ox = wrap(t * vx - cam.x) - FOG.size;
    const oy = wrap(t * vy - cam.y) - FOG.size;
    for (let x = ox; x < width; x += FOG.size) {
      for (let y = oy; y < height; y += FOG.size) b.drawImage(canvas, x, y);
    }
  }

  /** Thins the mist in an ellipse round a world point, as the ground lies. */
  const clear = (x, y, radius) => {
    const o = engine.worldToScreen(x, y);
    b.setTransform(scale, 0, 0, scale * 0.6, o.x * scale, o.y * scale);
    const g = b.createRadialGradient(0, 0, 0, 0, 0, radius);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.9)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    b.fillStyle = g;
    b.fillRect(-radius, -radius, radius * 2, radius * 2);
  };
  b.globalCompositeOperation = 'destination-out';
  const player = engine.getPlayer();
  if (player) {
    const half = engine.TILE_SIZE / 2;
    clear(player.position.x + half, player.position.y + half, FOG.clear);
  }
  // And round the lamps, so it gathers in the dark woods and the lit
  // churchyard stays sharp.
  for (const lamp of lamps) clear(lamp.x, lamp.y, FOG.clearLamp);

  ctx.save();
  ctx.translate(cam.x, cam.y);
  ctx.drawImage(fog, 0, 0, width, height);
  ctx.restore();
}, engine.OverlayLayer.scene + 1);
