import React, { useRef, useState, useEffect, useCallback } from 'react';
import { RuntimeNpc, NpcBehavior, Item } from '../../../shared/types';
import { drawSpriteGeneric } from '../../graphics/render';
import { updateNpc, createNpc, deleteNpc } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';
import { ItemIcon } from '../Inventory/ItemIcon';
import { colors, radius } from '../../theme';

interface NpcEditorProps {
  npcs: RuntimeNpc[];
  items: Item[];
  loadNpcs: () => Promise<any>;
  loadItems: () => Promise<any>;
  refreshData: () => void;
}

export const NpcEditor: React.FC<NpcEditorProps> = ({
  npcs,
  items,
  loadNpcs,
  loadItems,
  refreshData,
}) => {
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [sprite, setSprite] = useState(0);
  const [health, setHealth] = useState(1);
  const [attack, setAttack] = useState(1);
  const [behavior, setBehavior] = useState<NpcBehavior>('neutral');
  const [exp, setExp] = useState(0);
  const [dropItemId, setDropItemId] = useState<number | null>(null);
  const [dropChance, setDropChance] = useState(100);

  const canvasRef = useRef<HTMLCanvasElement>(null);

  const reset = () => {
    setSelectedId('');
    setName('');
    setSprite(0);
    setHealth(1);
    setAttack(1);
    setBehavior('neutral');
    setExp(0);
    setDropItemId(null);
    setDropChance(100);
  };

  const drawPreview = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      drawSpriteGeneric(ctx, sprite, 0, 0, 0, 0, 64, 64);
    },
    [sprite],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPreview(ctx);
  }, [drawPreview]);

  const selectNpc = (id: string) => {
    setSelectedId(id);
    const npc = npcs.find((n) => n.id === id);
    if (npc) {
      setName(npc.name);
      setSprite(npc.sprite);
      setHealth(npc.maxHealth ?? 1);
      setAttack(npc.attack ?? 1);
      setBehavior(npc.behavior);
      setExp(npc.experienceValue ?? 0);
      if (npc.itemsToDrop?.length) {
        setDropItemId(npc.itemsToDrop[0].itemId);
        setDropChance(Math.round(npc.itemsToDrop[0].chance * 100));
      } else {
        setDropItemId(null);
        setDropChance(100);
      }
    }
  };

  const saveNpc = async () => {
    const data = {
      name,
      sprite,
      maxHealth: health,
      attack,
      behavior,
      experienceValue: exp,
      itemsToDrop: dropItemId
        ? [{ itemId: dropItemId, chance: dropChance / 100 }]
        : [],
    };
    const result = selectedId
      ? await updateNpc(selectedId, data)
      : await createNpc(data);
    chatResultMsg(!!result, 'NPC saved!', 'Error saving NPC');
    refreshData();
    reset();
  };

  const removeNpc = async () => {
    if (!selectedId) return;
    await deleteNpc(selectedId);
    chatResultMsg(true, 'NPC deleted!', 'Error deleting NPC');
    refreshData();
    reset();
  };

  const behaviorOptions = [
    { value: 'neutral', label: 'Neutral' },
    { value: 'aggressive', label: 'Aggressive' },
    { value: 'hostile', label: 'Hostile' },
  ];

  const dropItem = items.find((i) => i.id === dropItemId);

  return (
    <div style={container}>
      <div style={field}>
        <label style={label}>NPC</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <AsyncSelect
              loadOptions={loadNpcs}
              value={selectedId}
              onChange={selectNpc}
            />
          </div>
          {selectedId && (
            <button style={resetBtn} onClick={reset}>
              New
            </button>
          )}
        </div>
      </div>

      <div style={cols}>
        <div style={leftCol}>
          <canvas
            ref={canvasRef}
            width={64}
            height={64}
            style={previewCanvas}
          />
          <div style={field}>
            <label style={label}>Sprite ID</label>
            <input
              style={input}
              type="number"
              value={sprite}
              onChange={(e) => setSprite(+e.target.value)}
            />
          </div>
        </div>

        <div style={rightCol}>
          <div style={field}>
            <label style={label}>Name</label>
            <input
              style={input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="NPC name"
            />
          </div>
          <div style={field}>
            <label style={label}>Behavior</label>
            <AsyncSelect
              loadOptions={async () => behaviorOptions}
              value={behavior}
              onChange={(v) => setBehavior(v as NpcBehavior)}
            />
          </div>
          <div style={triRow}>
            <div style={field}>
              <label style={label}>HP</label>
              <input
                style={input}
                type="number"
                value={health}
                onChange={(e) => setHealth(+e.target.value)}
              />
            </div>
            <div style={field}>
              <label style={label}>ATK</label>
              <input
                style={input}
                type="number"
                value={attack}
                onChange={(e) => setAttack(+e.target.value)}
              />
            </div>
            <div style={field}>
              <label style={label}>EXP</label>
              <input
                style={input}
                type="number"
                value={exp}
                onChange={(e) => setExp(+e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={dropSection}>
        <div style={dropRow}>
          <div style={{ flex: 1 }}>
            <label style={label}>Drop item</label>
            <AsyncSelect<number>
              loadOptions={loadItems}
              value={dropItemId ?? 0}
              onChange={(id) => setDropItemId(id)}
            />
          </div>
          {dropItemId && (
            <div style={{ width: 80 }}>
              <label style={label}>Chance %</label>
              <input
                style={input}
                type="number"
                min={0}
                max={100}
                value={dropChance}
                onChange={(e) =>
                  setDropChance(Math.min(100, Math.max(0, +e.target.value)))
                }
              />
            </div>
          )}
          {dropItem && <ItemIcon spriteId={dropItem.sprite} style={dropIcon} />}
        </div>
      </div>

      <div style={actions}>
        <button style={saveBtn} onClick={saveNpc}>
          {selectedId ? 'Save NPC' : 'Create NPC'}
        </button>
        {selectedId && (
          <button style={deleteBtn} onClick={removeNpc}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
};

const container: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const cols: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 1fr',
  gap: 14,
};

const leftCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  alignItems: 'center',
};

const rightCol: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const triRow: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr 1fr',
  gap: 8,
};

const previewCanvas: React.CSSProperties = {
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  background: colors.surfaceMuted,
};

const dropSection: React.CSSProperties = {
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
};

const dropRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-end',
  gap: 10,
};

const dropIcon: React.CSSProperties = {
  width: 36,
  height: 36,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.sm,
  flexShrink: 0,
};

const field: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: colors.textMuted,
};

const input: React.CSSProperties = {
  padding: '7px 9px',
  border: `1.5px solid ${colors.border}`,
  borderRadius: radius.sm,
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  background: colors.surface,
};

const actions: React.CSSProperties = { display: 'flex', gap: 8 };

const saveBtn: React.CSSProperties = {
  flex: 1,
  background: colors.primary,
  color: '#fff',
  border: 'none',
  padding: '9px 16px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};

const deleteBtn: React.CSSProperties = {
  background: colors.danger,
  color: '#fff',
  border: 'none',
  padding: '9px 14px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
};

const resetBtn: React.CSSProperties = {
  background: colors.surfaceMuted,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  padding: '7px 12px',
  borderRadius: radius.md,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 13,
  whiteSpace: 'nowrap',
};
