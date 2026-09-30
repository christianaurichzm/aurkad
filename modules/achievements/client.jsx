// @ts-check
// Achievements module, client entry: a window with one row per definition
// and a toast when one is earned.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT(). Definition names
// and descriptions from game.json use the same table.
engine.i18n({
  pt: {
    Achievements: 'Conquistas',
    'Nothing defined yet.': 'Nada definido ainda.',
    'This game has no achievements to earn.':
      'Este jogo não tem conquistas para ganhar.',
    'Unlocked {date}': 'Desbloqueada em {date}',
    Unlocked: 'Desbloqueada',
    '{achievement} progress': 'Progresso de {achievement}',
    'Achievement unlocked': 'Conquista desbloqueada',
  },
});

const ui = engine.ui;

// { earned: [id], at: { id: epoch ms }, all: [{ id, name, description, progress, target }] }
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
      title={t('Achievements')}
      counter={
        rows.length ? `${state.earned.length}/${rows.length}` : undefined
      }
      width="regular"
      anchor="right"
      onClose={toggle}
    >
      {rows.length === 0 ? (
        <ui.EmptyState
          icon="trophy"
          title={t('Nothing defined yet.')}
          hint={t('This game has no achievements to earn.')}
        />
      ) : (
        <ul className="list">
          {rows.map((entry) => (
            <AchievementRow
              key={entry.id}
              entry={entry}
              earned={state.earned.includes(entry.id)}
              at={state.at?.[entry.id]}
            />
          ))}
        </ul>
      )}
    </ui.Window>
  );
}

function AchievementRow({ entry, earned, at }) {
  const t = engine.useT();
  const name = t(entry.name);
  return (
    <li className="list-row" data-dim={earned ? undefined : true}>
      <span
        className="avatar"
        data-earned={earned || undefined}
        aria-hidden="true"
      >
        <span
          className="icon"
          style={
            /** @type {React.CSSProperties} */ ({
              '--icon': 'var(--icon-trophy)',
            })
          }
        />
      </span>
      <span className="list-row-text">
        <b>{name}</b>
        {entry.description && <small>{t(entry.description)}</small>}
        {earned && (
          <small>
            {at
              ? t('Unlocked {date}', {
                  date: new Date(at).toLocaleDateString(undefined, {
                    dateStyle: 'medium',
                  }),
                })
              : t('Unlocked')}
          </small>
        )}
        {/* A locked one shows how far along it is; an earned one has nothing
            left to say, and a full bar under it reads as a second,
            contradictory state. */}
        {!earned && entry.target > 1 && (
          <span
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              className="meter"
              role="meter"
              aria-label={t('{achievement} progress', { achievement: name })}
              aria-valuemin={0}
              aria-valuemax={entry.target}
              aria-valuenow={entry.progress}
            >
              <span
                style={{ width: `${(entry.progress / entry.target) * 100}%` }}
              />
            </span>
            <b className="stack-count">
              {entry.progress}/{entry.target}
            </b>
          </span>
        )}
      </span>
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

ui.actionButton('Achievements', toggle, 'k', 'trophy', 100);

engine.onServerEvent('achievements:update', (payload) => {
  if (!payload) return;
  state = payload;
  draw();
});

engine.onServerEvent('achievements:earned', (payload) => {
  if (payload && payload.name) toast(payload);
});

engine.sendServerEvent('achievements:request');
