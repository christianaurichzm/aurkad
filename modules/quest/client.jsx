// @ts-check
// Quest module, client entry: the quest log (Q), with active and completed
// quests and the picked one's progress and reward. Starting or completing
// one shows a toast and a chat line.

// Translations keyed by the English text. `ui` helpers translate on their
// own; other text goes through engine.t or engine.useT().
engine.i18n({
  pt: {
    Quests: 'Missões',
    '{count} active': '{count} ativas',
    'No quests yet.': 'Nenhuma missão ainda.',
    'Talk to the people you meet to pick one up.':
      'Fale com quem você encontrar para pegar uma.',
    'Quest list': 'Lista de missões',
    Active: 'Ativas',
    Completed: 'Concluídas',
    None: 'Nenhuma',
    'From {giver}': 'De {giver}',
    Progress: 'Progresso',
    Rewards: 'Recompensas',
    '{quest} progress': 'Progresso de {quest}',
    'Completed - rewards claimed.': 'Concluída - recompensas recebidas.',
    'Quest completed: {quest}': 'Missão concluída: {quest}',
    '✓ Quest complete: {quest}': '✓ Missão concluída: {quest}',
    'Quest started: {quest}': 'Missão iniciada: {quest}',
    'New quest: {quest}': 'Nova missão: {quest}',
  },
});

const ui = engine.ui;

// [{ id, name, description, progress, target, status, from?, reward? }]
let quests = [];
let shown = false;
// The quest whose detail is open; the first active one until one is picked.
let picked = null;
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

function pick(id) {
  picked = id;
  draw();
}

const section = { display: 'grid', gap: 6, alignContent: 'start' };

function QuestWindow({ list }) {
  const t = engine.useT();
  const active = list.filter((q) => q.status === 'active');
  const done = list.filter((q) => q.status === 'completed');
  if (list.length === 0)
    return (
      <ui.Window title={t('Quests')} width="wide" onClose={toggle}>
        <ui.EmptyState
          icon="quest"
          title={t('No quests yet.')}
          hint={t('Talk to the people you meet to pick one up.')}
        />
      </ui.Window>
    );
  const open = list.find((q) => q.id === picked) ?? active[0] ?? done[0];
  return (
    <ui.Window
      title={t('Quests')}
      counter={t('{count} active', { count: active.length })}
      width="wide"
      onClose={toggle}
    >
      <div className="window-split">
        <nav style={{ ...section, gap: 10 }} aria-label={t('Quest list')}>
          <QuestList title={t('Active')} list={active} open={open} />
          <QuestList title={t('Completed')} list={done} open={open} />
        </nav>
        <Detail q={open} />
      </div>
    </ui.Window>
  );
}

function QuestList({ title, list, open }) {
  const t = engine.useT();
  return (
    <section style={section}>
      <h3 className="window-heading">{title}</h3>
      {list.length === 0 ? (
        <span className="window-label">{t('None')}</span>
      ) : (
        <ul className="list">
          {list.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                className="chip"
                style={{ width: '100%', textAlign: 'left' }}
                aria-current={q.id === open.id}
                onClick={() => pick(q.id)}
              >
                {q.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Detail({ q }) {
  const t = engine.useT();
  const done = q.status === 'completed';
  const reward = q.reward;
  return (
    <article className="window-aside" style={section} aria-label={q.name}>
      <h3 className="window-heading" style={{ fontSize: 16 }}>
        {q.name}
      </h3>
      {q.from && (
        <span className="window-label">
          {t('From {giver}', { giver: q.from })}
        </span>
      )}
      {q.description && <p>{q.description}</p>}
      {done ? (
        <span className="window-label">
          {t('Completed - rewards claimed.')}
        </span>
      ) : (
        <div style={{ display: 'grid', gap: 3 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="window-label">{t('Progress')}</span>
            <b className="stack-count">
              {q.progress}/{q.target}
            </b>
          </span>
          <span
            className="meter"
            role="meter"
            aria-label={t('{quest} progress', { quest: q.name })}
            aria-valuemin={0}
            aria-valuemax={q.target}
            aria-valuenow={q.progress}
          >
            <span
              style={{
                width: `${q.target > 0 ? (q.progress / q.target) * 100 : 100}%`,
              }}
            />
          </span>
        </div>
      )}
      {reward && (reward.experience > 0 || reward.items.length > 0) && (
        <>
          <span className="window-label">{t('Rewards')}</span>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {reward.items.map((item) => {
              const label = `${item.name} x${item.quantity}`;
              return (
                <span
                  key={item.name}
                  role="img"
                  title={label}
                  aria-label={label}
                  style={{ display: 'inline-flex', alignItems: 'center' }}
                >
                  <ui.ItemIcon spriteId={item.sprite ?? 0} size={32} />
                  <b className="stack-count">x{item.quantity}</b>
                </span>
              );
            })}
            {reward.experience > 0 && (
              <span>
                <b className="stack-count">+{reward.experience}</b> XP
              </span>
            )}
          </div>
        </>
      )}
    </article>
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

ui.actionButton('Quests', toggle, 'q', 'quest', 40);

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
