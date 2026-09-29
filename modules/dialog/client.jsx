// @ts-check
// Dialog module client: renders a centered modal dialog box when the server
// sends dialog:show. Number keys 1-9 pick a choice; Escape picks the last one
// (typically "Goodbye" / "Cancel"). All key events are captured so the game
// does not move the player while the dialog is open.

// The one string this module owns; dialog text and choices are content, written
// by the operator in the language of their game.
engine.i18n({ pt: { Continue: 'Continuar', Conversation: 'Conversa' } });

const { useEffect, useId, useRef } = React;

let current = null; // the dialog:show payload on screen

function draw() {
  engine.render(current && <NpcDialog d={current} />);
}

function pick(d, index) {
  // React unmounts the box later; a second key or click before then must
  // not answer twice.
  if (current !== d) return;
  current = null;
  draw();
  engine.sendServerEvent('dialog:choose', { id: d.id, index });
}

function NpcDialog({ d }) {
  const t = engine.useT();
  const id = useId();
  const box = useRef(null);
  const choices = Array.isArray(d.choices) ? d.choices : [];
  const labels = choices.length > 0 ? choices : [t('Continue')];
  const last = labels.length - 1;

  useEffect(() => {
    const releaseFocus = engine.ui.focusDialog(box.current);
    function onKey(e) {
      if (e.key === 'Tab') return;
      // Block all game input while the dialog is open.
      e.stopPropagation();
      if (e.repeat) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        pick(d, last);
        return;
      }
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= last + 1) {
        e.preventDefault();
        pick(d, n - 1);
      }
    }
    // Capture phase, so this runs before the game's keyboard handler.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      releaseFocus();
    };
  }, [d, last]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
      }}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-speaker`}
        aria-describedby={`${id}-text`}
        tabIndex={-1}
        style={{
          background: 'var(--color-surface)',
          color: 'var(--color-text)',
          border: '2px solid var(--color-border)',
          borderRadius: 'var(--radius-panel)',
          padding: '24px 28px',
          maxWidth: 560,
          width: '88%',
          boxSizing: 'border-box',
          maxHeight: '90dvh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          fontSize: 18,
          lineHeight: 1.6,
        }}
      >
        <h2
          id={`${id}-speaker`}
          style={{
            fontSize: 20,
            margin: '0 0 12px',
            color: 'var(--color-primary)',
          }}
        >
          {d.speaker || t('Conversation')}
        </h2>
        <p
          id={`${id}-text`}
          style={{ margin: '0 0 16px', whiteSpace: 'pre-wrap' }}
        >
          {d.text || ''}
        </p>
        {labels.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => pick(d, i)}
            style={{
              display: 'block',
              width: '100%',
              marginBottom: 8,
              padding: '11px 14px',
              fontSize: 16,
              lineHeight: 1.4,
              textAlign: 'left',
            }}
          >
            {`${i + 1}. ${label}`}
          </button>
        ))}
      </div>
    </div>
  );
}

engine.onServerEvent('dialog:show', (payload) => {
  current = payload;
  draw();
});

engine.log('Dialog client ready.');
