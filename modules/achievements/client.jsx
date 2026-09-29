// @ts-check
// Achievements module, client entry: a window with one row per definition
// and a toast when one is earned.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT(). Definition names
// and descriptions from game.json use the same table.
engine.i18n({
  pt: {
    Achievements: 'Conquistas',
    'Achievements ({earned}/{total})': 'Conquistas ({earned}/{total})',
    'Nothing defined yet.': 'Nada definido ainda.',
    'Achievement unlocked': 'Conquista desbloqueada',
  },
});

const ui = engine.ui;

let state = { earned: [], all: [] };
let shown = false;

function draw() {
  engine.render(shown && <AchievementsWindow state={state} />);
}

function toggle() {
  shown = !shown;
  draw();
}

function AchievementsWindow({ state }) {
  const t = engine.useT();
  // Earned first: the list is a trophy case before it is a to-do list.
  const rows = state.all.slice().sort((a, b) => {
    const ea = state.earned.includes(a.id) ? 0 : 1;
    const eb = state.earned.includes(b.id) ? 0 : 1;
    return ea - eb;
  });
  return (
    <ui.Window
      title={t('Achievements ({earned}/{total})', {
        earned: state.earned.length,
        total: state.all.length,
      })}
      onClose={toggle}
    >
      {rows.length === 0 ? (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-muted)',
            padding: '8px 0',
          }}
        >
          {t('Nothing defined yet.')}
        </div>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            maxHeight: 280,
            overflowY: 'auto',
          }}
        >
          {rows.map((entry) => (
            <AchievementRow
              key={entry.id}
              entry={entry}
              earned={state.earned.includes(entry.id)}
            />
          ))}
        </ul>
      )}
    </ui.Window>
  );
}

function AchievementRow({ entry, earned }) {
  const t = engine.useT();
  return (
    <li
      style={{
        padding: '6px 0',
        borderBottom: '1px solid var(--color-border)',
        opacity: earned ? 1 : 0.65,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          style={{
            color: earned ? 'var(--color-warning)' : 'var(--color-text-muted)',
            fontSize: 14,
          }}
        >
          {earned ? '★' : '☆'}
        </span>
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontWeight: 'bold',
            color: 'var(--color-text)',
          }}
        >
          {t(entry.name)}
        </span>
      </div>
      {entry.description && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginLeft: 20,
          }}
        >
          {t(entry.description)}
        </div>
      )}
      {/* A locked one shows how far along it is; an earned one has nothing
          left to say, and a full bar under a star reads as a second,
          contradictory state. */}
      {!earned && entry.target > 1 && (
        <>
          <div
            style={{
              height: 4,
              background: 'var(--color-border)',
              borderRadius: 2,
              margin: '4px 0 0 20px',
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.round((entry.progress / entry.target) * 100)}%`,
                background: 'var(--color-success)',
                borderRadius: 2,
              }}
            />
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--color-text-muted)',
              marginLeft: 20,
              textAlign: 'right',
            }}
          >
            {entry.progress}/{entry.target}
          </div>
        </>
      )}
    </li>
  );
}

function toast(entry) {
  ui.notice(entry.name, {
    tone: 'highlight',
    label: '★ ' + engine.t('Achievement unlocked'),
    ms: 2600,
  });
}

ui.actionButton('Achievements', toggle, 'k');

engine.onServerEvent('achievements:update', (payload) => {
  if (!payload) return;
  state = payload;
  draw();
});

engine.onServerEvent('achievements:earned', (payload) => {
  if (payload && payload.name) toast(payload);
});

engine.sendServerEvent('achievements:request');
