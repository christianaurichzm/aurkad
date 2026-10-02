// @ts-check
// Dialog module client: a box at the foot of the world with the speaker,
// their portrait, the line typed out and the answers under it.
//
// Answers appear once the line is whole (Space, Enter or a click finishes
// it), then a number key or the arrows pick. Escape closes without an
// answer. Keys are captured so the player does not move meanwhile.

// The strings this module owns; dialog text and choices are content, written
// by the operator in the language of their game.
engine.i18n({
  pt: {
    Continue: 'Continuar',
    Conversation: 'Conversa',
    'Leave the conversation': 'Sair da conversa',
  },
});

const { useCallback, useEffect, useId, useRef, useState } = React;
const ui = engine.ui;

const LETTERS_PER_SECOND = 40;

let current = null; // the dialog:show payload on screen

// The world darkens on the scene layer around whoever is talking, so names
// stay lit. --dialog-dim (theme.json) sets how much.
let dimColour = '';
let stopDim = null;

function drawDim(ctx, cam) {
  const npc = engine.getGameState()?.npcs[current?.npcId];
  if (npc) {
    const tile = engine.TILE_SIZE;
    const x = npc.position.x + tile / 2;
    const y = npc.position.y + tile / 2;
    const light = ctx.createRadialGradient(x, y, tile, x, y, tile * 4);
    light.addColorStop(0, 'transparent');
    light.addColorStop(1, dimColour);
    ctx.fillStyle = light;
  } else {
    ctx.fillStyle = dimColour;
  }
  ctx.fillRect(cam.x, cam.y, engine.GAME_WIDTH, engine.GAME_HEIGHT);
}

function draw() {
  if (current && !stopDim) {
    dimColour = getComputedStyle(document.documentElement)
      .getPropertyValue('--dialog-dim')
      .trim();
    if (dimColour && dimColour !== 'transparent')
      stopDim = engine.registerOverlay(drawDim, engine.OverlayLayer.scene);
  } else if (!current && stopDim) {
    stopDim();
    stopDim = null;
  }
  engine.render(current && <NpcDialog d={current} />);
}

function end(d, channel, answer) {
  // React unmounts the box later; a second key or click before then must
  // not answer twice.
  if (current !== d) return;
  current = null;
  draw();
  engine.sendServerEvent(channel, { id: d.id, ...answer });
}

const pick = (d, index) => end(d, 'dialog:choose', { index });
const leave = (d) => end(d, 'dialog:close');

/** How much of `text` is said so far, and a way to say the rest at once. */
function useTypewriter(text) {
  const [said, setSaid] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      setSaid(text.length);
      return;
    }
    setSaid(0);
    const start = performance.now();
    const timer = setInterval(() => {
      const letters = Math.floor(
        ((performance.now() - start) / 1000) * LETTERS_PER_SECOND,
      );
      setSaid((now) => Math.max(now, Math.min(letters, text.length)));
      if (letters >= text.length) clearInterval(timer);
    }, 25);
    return () => clearInterval(timer);
  }, [text]);
  const finish = useCallback(() => setSaid(text.length), [text]);
  return { said: Math.min(said, text.length), finish };
}

/** Where the world is on the page, followed through a resize. */
function useWorldBox() {
  const read = () =>
    document.getElementById('canvasFrame')?.getBoundingClientRect();
  const [box, setBox] = useState(read);
  useEffect(() => {
    const onResize = () => setBox(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // With no world on the page the box has the whole of it.
  return box
    ? { left: box.left, top: box.top, width: box.width, height: box.height }
    : { inset: 0 };
}

function NpcDialog({ d }) {
  const t = engine.useT();
  const id = useId();
  const box = useRef(null);
  const world = useWorldBox();
  const text = d.text || '';
  const { said, finish } = useTypewriter(text);
  const whole = said >= text.length;
  const choices = Array.isArray(d.choices) ? d.choices : [];
  const labels = choices.length > 0 ? choices : [t('Continue')];
  const read = Array.isArray(d.read) ? d.read : [];

  useEffect(() => ui.focusDialog(box.current), [d]);

  // Enter answers with the choice that has focus, so the first one takes it
  // as soon as there is something to answer.
  useEffect(() => {
    if (whole) box.current?.querySelector('.dialog-choice')?.focus();
  }, [d, whole]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Tab') return;
      // Block all game input while the dialog is open.
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        leave(d);
      } else if (!whole) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          finish();
        }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const buttons = [...box.current.querySelectorAll('.dialog-choice')];
        const at = buttons.indexOf(document.activeElement);
        const step = e.key === 'ArrowDown' ? 1 : -1;
        buttons[(at + step + buttons.length) % buttons.length]?.focus();
      } else {
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= labels.length) {
          e.preventDefault();
          pick(d, n - 1);
        }
      }
    }
    // Capture phase, so this runs before the game's keyboard handler.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [d, whole, labels.length, finish]);

  return (
    <div className="dialog-screen">
      <div className="dialog-layer" style={world}>
        <div
          ref={box}
          className="npc-dialog panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-speaker`}
          aria-describedby={`${id}-text`}
          tabIndex={-1}
        >
          {d.sprite !== undefined && (
            <span className="dialog-portrait" data-sprite={d.sprite}>
              <ui.Sprite spriteId={d.sprite} />
            </span>
          )}
          <div className="dialog-body">
            <h2 id={`${id}-speaker`} className="window-heading">
              {d.speaker || t('Conversation')}
            </h2>
            <p id={`${id}-text`} className="dialog-line" onClick={finish}>
              {text.slice(0, said)}
              <span>{text.slice(said)}</span>
            </p>
            <ol
              className="dialog-choices"
              data-waiting={whole ? undefined : ''}
            >
              {labels.map((label, i) => (
                <li key={i}>
                  <button
                    type="button"
                    className="dialog-choice"
                    data-read={read.includes(i) ? '' : undefined}
                    aria-label={`${i + 1}. ${label}`}
                    onClick={() => pick(d, i)}
                  >
                    <b aria-hidden="true">{i + 1}</b>
                    {label}
                  </button>
                </li>
              ))}
            </ol>
          </div>
          <button
            type="button"
            className="window-close"
            aria-label={t('Leave the conversation')}
            onClick={() => leave(d)}
          >
            <span
              className="icon"
              aria-hidden="true"
              style={
                /** @type {React.CSSProperties} */ ({
                  '--icon': 'var(--icon-close)',
                })
              }
            />
          </button>
        </div>
      </div>
    </div>
  );
}

engine.onServerEvent('dialog:show', (payload) => {
  current = payload;
  draw();
});

engine.log('Dialog client ready.');
