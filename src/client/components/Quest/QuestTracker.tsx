import { colors, radius } from '../../theme';
import React, { useEffect, useState } from 'react';
import { onServerEvent } from '../../io/network/customEvents';
import { useT } from '../../i18n';

interface Quest {
  id: string;
  name: string;
  description: string;
  progress: number;
  target: number;
  status: 'active' | 'completed';
}

// Built-in quest tracker: shows active quests from the `quest:update`
// channel the quest module pushes.
export const QuestTracker: React.FC = () => {
  const t = useT();
  const [quests, setQuests] = useState<Quest[]>([]);

  useEffect(() => {
    return onServerEvent('quest:update', (payload) => {
      if (Array.isArray(payload)) setQuests(payload as Quest[]);
    });
  }, []);

  const active = quests.filter((q) => q.status === 'active');
  if (active.length === 0) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        background: colors.overlay,
        color: colors.text,
        padding: '8px 12px',
        borderRadius: radius.md,
        border: `1px solid ${colors.border}`,
        fontSize: 13,
        maxWidth: 220,
        pointerEvents: 'none',
      }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 4 }}>
        {t('quest.title')}
      </div>
      {active.map((q) => (
        <div key={q.id} style={{ marginBottom: 4 }}>
          <div>{q.name}</div>
          <div style={{ opacity: 0.8 }}>
            {q.description}
            {q.target > 1
              ? ` (${t('quest.progress', { current: q.progress, target: q.target })})`
              : ''}
          </div>
        </div>
      ))}
    </div>
  );
};
