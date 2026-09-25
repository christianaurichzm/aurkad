import { colors, radius, zIndex } from '../../theme';
import React, { useEffect, useState } from 'react';
import { onServerEvent } from '../../io/network/customEvents';
import { useT } from '../../i18n';

interface Quest {
  id: string;
  name: string;
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

  // One line per quest with its progress; the story is in the quest log (Q).
  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        background: colors.overlay,
        color: colors.text,
        padding: '6px 10px',
        borderRadius: radius.md,
        border: `1px solid ${colors.border}`,
        fontSize: 12,
        maxWidth: 220,
        pointerEvents: 'none',
        // The canvases in the frame are stacked themselves; without a layer of
        // its own the tracker sits under them.
        zIndex: zIndex.gameOverlay,
      }}
    >
      {active.map((q) => (
        <div key={q.id} style={{ display: 'flex', gap: 10 }}>
          <span style={{ flex: 1 }}>{q.name}</span>
          <span style={{ color: colors.textMuted }}>
            {t('quest.progress', { current: q.progress, target: q.target })}
          </span>
        </div>
      ))}
    </div>
  );
};
