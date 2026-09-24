// @ts-check
// Dialog module client: renders a centered modal dialog box when the server
// sends dialog:show. Number keys 1-9 pick a choice; Escape picks the last one
// (typically "Goodbye" / "Cancel"). All key events are captured so the game
// does not move the player while the dialog is open.

// The one string this module owns; dialog text and choices are content, written
// by the operator in the language of their game.
engine.i18n({ pt: { Continue: 'Continuar', Conversation: 'Conversa' } });

var activeCleanup = null;

function closeDialog() {
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
}

engine.onServerEvent('dialog:show', function (payload) {
  closeDialog();

  var id = payload.id;
  var text = payload.text || '';
  var choices = Array.isArray(payload.choices) ? payload.choices : [];
  var labels = choices.length > 0 ? choices : [engine.t('Continue')];

  // Backdrop
  var overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,0.45);';

  // Box
  var box = document.createElement('div');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-labelledby', 'npc-dialog-speaker');
  box.setAttribute('aria-describedby', 'npc-dialog-text');
  box.tabIndex = -1;
  box.style.cssText =
    'background:var(--color-surface);color:var(--color-text);border:2px solid var(--color-border);border-radius:8px;' +
    'padding:24px 28px;max-width:560px;width:88%;box-sizing:border-box;max-height:90dvh;overflow:auto;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.7);font:18px/1.6 sans-serif;';

  var speaker = document.createElement('h2');
  speaker.id = 'npc-dialog-speaker';
  speaker.textContent = payload.speaker || engine.t('Conversation');
  speaker.style.cssText =
    'font-size:20px;margin:0 0 12px;color:var(--color-primary);';
  box.appendChild(speaker);
  var textEl = document.createElement('p');
  textEl.id = 'npc-dialog-text';
  textEl.style.cssText = 'margin:0 0 16px;white-space:pre-wrap;';
  textEl.textContent = text;
  box.appendChild(textEl);

  function pick(index) {
    closeDialog();
    engine.sendServerEvent('dialog:choose', { id: id, index: index });
  }

  labels.forEach(function (label, i) {
    var btn = document.createElement('button');
    btn.textContent = i + 1 + '. ' + label;
    btn.style.cssText =
      'display:block;width:100%;margin-bottom:8px;padding:11px 14px;' +
      'background:var(--surface-control);color:var(--color-text);border:1px solid var(--color-border);border-radius:4px;' +
      'cursor:pointer;font:16px/1.4 sans-serif;text-align:left;';
    btn.onmouseenter = function () {
      btn.style.background = 'var(--surface-control-hover)';
    };
    btn.onmouseleave = function () {
      btn.style.background = 'var(--surface-control)';
    };
    btn.onclick = function () {
      pick(i);
    };
    box.appendChild(btn);
  });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  var releaseFocus = engine.ui.focusDialog(box);

  function onKey(e) {
    if (e.key === 'Tab') return;
    // Block all game input while dialog is open.
    e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      pick(labels.length - 1);
      return;
    }
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= labels.length) {
      e.preventDefault();
      pick(n - 1);
    }
  }

  // Capture phase so we intercept before keyboard.ts sees it.
  window.addEventListener('keydown', onKey, true);

  activeCleanup = function () {
    window.removeEventListener('keydown', onKey, true);
    overlay.remove();
    releaseFocus();
  };
});

engine.log('Dialog client ready.');
