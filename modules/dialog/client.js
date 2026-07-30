// @ts-check
// Dialog module client: renders a centered modal dialog box when the server
// sends dialog:show. Number keys 1-9 pick a choice; Escape picks the last one
// (typically "Goodbye" / "Cancel"). All key events are captured so the game
// does not move the player while the dialog is open.

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
  var labels = choices.length > 0 ? choices : ['Continue'];

  // Backdrop
  var overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2000;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(0,0,0,0.45);';

  // Box
  var box = document.createElement('div');
  box.style.cssText =
    'background:#1a1a2e;color:#e0e0e0;border:2px solid #555;border-radius:8px;' +
    'padding:22px 26px;max-width:420px;width:88%;' +
    'box-shadow:0 8px 32px rgba(0,0,0,0.7);font:14px/1.6 sans-serif;';

  var textEl = document.createElement('p');
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
      'display:block;width:100%;margin-bottom:5px;padding:7px 11px;' +
      'background:#252540;color:#e0e0e0;border:1px solid #444;border-radius:4px;' +
      'cursor:pointer;font:13px sans-serif;text-align:left;';
    btn.onmouseenter = function () {
      btn.style.background = '#35356a';
    };
    btn.onmouseleave = function () {
      btn.style.background = '#252540';
    };
    btn.onclick = function () {
      pick(i);
    };
    box.appendChild(btn);
  });

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function onKey(e) {
    // Block all game input while dialog is open.
    e.stopPropagation();
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
  };
});

engine.log('Dialog client ready.');
