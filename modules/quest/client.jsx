// @ts-check
// Quest module, client entry: a tracker window (Q) with the active quests
// and a progress bar each, completed ones in a collapsed section. Starting
// or completing a quest shows a toast and logs a chat message.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Quests: 'Missões',
    'Quests ({count} active)': 'Missões ({count} ativas)',
    'No quests yet.': 'Nenhuma missão ainda.',
    '✓ Done': '✓ Feita',
    'Completed ({count})': 'Concluídas ({count})',
    'Quest completed: {quest}': 'Missão concluída: {quest}',
    '✓ Quest complete: {quest}': '✓ Missão concluída: {quest}',
    'Quest started: {quest}': 'Missão iniciada: {quest}',
    'New quest: {quest}': 'Nova missão: {quest}',
  },
});

const ui = engine.ui;

let quests = []; // [{ id, name, description, progress, target, status }]
let shown = false;
let prevStatuses = {}; // id → status, for detecting transitions
// The first list is what the player already had when the game opened.
let listed = false;

function draw() {
  engine.render(shown && <QuestWindow list={quests} />);
}

function toggle() {
  shown = !shown;
  draw();
  if (shown) engine.sendServerEvent('quest:request');
}

function QuestWindow({ list }) {
  const t = engine.useT();
  const active = list.filter((q) => q.status === 'active');
  const done = list.filter((q) => q.status === 'completed');
  return (
    <ui.Window
      title={
        list.length === 0
          ? t('Quests')
          : t('Quests ({count} active)', { count: active.length })
      }
      onClose={toggle}
    >
      {list.length === 0 ? (
        <div
          style={{
            color: 'var(--color-text-muted)',
            fontSize: 12,
            padding: '4px 0',
          }}
        >
          {t('No quests yet.')}
        </div>
      ) : (
        <>
          <QuestList list={active} />
          {done.length > 0 && (
            <details style={{ marginTop: 6, fontSize: 12 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  color: 'var(--color-text-muted)',
                  userSelect: 'none',
                  padding: '2px 0',
                }}
              >
                {t('Completed ({count})', { count: done.length })}
              </summary>
              <QuestList list={done} />
            </details>
          )}
        </>
      )}
    </ui.Window>
  );
}

function QuestList({ list }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {list.map((q) => (
        <QuestCard key={q.id} q={q} />
      ))}
    </ul>
  );
}

function QuestCard({ q }) {
  const t = engine.useT();
  const done = q.status === 'completed';
  const pct = q.target > 0 ? Math.round((q.progress / q.target) * 100) : 100;
  return (
    <li
      style={{
        padding: '6px 8px',
        borderRadius: 'var(--radius-control)',
        border: `1px solid ${done ? '#2a4a2a' : 'var(--color-border)'}`,
        background: done
          ? 'var(--color-selected)'
          : 'var(--color-surface-muted)',
        marginBottom: 4,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 13,
        }}
      >
        <span
          style={{
            fontWeight: 'bold',
            color: done ? 'var(--color-success)' : 'var(--color-text)',
          }}
        >
          {q.name}
        </span>
        <span
          style={{
            fontSize: 11,
            color: done ? 'var(--color-success)' : 'var(--color-text-muted)',
          }}
        >
          {done ? t('✓ Done') : `${q.progress}/${q.target}`}
        </span>
      </div>
      {q.description && (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            marginTop: 2,
          }}
        >
          {q.description}
        </div>
      )}
      {!done && (
        <div
          style={{
            width: '100%',
            height: 6,
            background: 'var(--color-surface-muted)',
            borderRadius: 3,
            overflow: 'hidden',
            marginTop: 3,
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${pct}%`,
              background: 'var(--color-warning)',
              borderRadius: 3,
              transition: 'width .3s',
            }}
          />
        </div>
      )}
    </li>
  );
}

// What finishing a quest paid, as the server describes it: `{ experience,
// items: [{ name, quantity }] }`, absent for a reward only a script knows.
function rewardLine(reward) {
  if (!reward) return '';
  const parts = [];
  if (reward.experience) parts.push(`+${reward.experience} XP`);
  for (const item of reward.items || [])
    parts.push(`+${item.quantity} ${item.name}`);
  return parts.join(' · ');
}

function toast(text, detail) {
  ui.notice(text, { tone: 'warning', detail, ms: 3500 });
}

ui.actionButton('Quests', toggle, 'q');

engine.onServerEvent('quest:update', (list) => {
  if (!Array.isArray(list)) return;

  for (const q of list) {
    const was = prevStatuses[q.id];
    if (q.status === 'completed' && was === 'active') {
      engine.chat(engine.t('Quest completed: {quest}', { quest: q.name }));
      toast(
        engine.t('✓ Quest complete: {quest}', { quest: q.name }),
        rewardLine(q.reward),
      );
    } else if (listed && q.status === 'active' && !was) {
      engine.chat(engine.t('Quest started: {quest}', { quest: q.name }));
      toast(engine.t('New quest: {quest}', { quest: q.name }));
    }
  }
  listed = true;

  prevStatuses = {};
  for (const q of list) prevStatuses[q.id] = q.status;

  quests = list;
  draw();
});

engine.sendServerEvent('quest:request');
