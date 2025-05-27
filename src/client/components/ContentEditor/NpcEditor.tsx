import React, { useRef, useState, useEffect, useCallback } from 'react';
import { RuntimeNpc, NpcBehavior } from '../../../shared/types';
import { drawSpriteGeneric } from '../../graphics/render';
import { updateNpc, createNpc, deleteNpc } from '../../io/network';
import { chatResultMsg } from '../ChatPanel';
import { AsyncSelect } from '../common/Select/AsyncSelect';

interface NpcEditorProps {
  npcs: RuntimeNpc[];
  loadNpcs: () => Promise<any>;
  refreshData: () => void;
}

export const NpcEditor: React.FC<NpcEditorProps> = ({
  npcs,
  loadNpcs,
  refreshData,
}) => {
  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [sprite, setSprite] = useState(0);
  const [health, setHealth] = useState(1);
  const [attack, setAttack] = useState(1);
  const [behavior, setBehavior] = useState<NpcBehavior>('neutral');
  const [exp, setExp] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const reset = () => {
    setSelectedId('');
    setName('');
    setSprite(0);
    setHealth(1);
    setAttack(1);
    setBehavior('neutral');
    setExp(0);
  };

  const drawNpc = useCallback(
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
    drawNpc(ctx);
  }, [drawNpc]);

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

  return (
    <div style={styles.group}>
      <h3 style={styles.h3}>NPC Editor</h3>
      <label style={styles.label}>Selecione NPC</label>
      <AsyncSelect
        loadOptions={loadNpcs}
        value={selectedId}
        onChange={selectNpc}
      />
      <label style={styles.label}>Name</label>
      <input
        style={styles.input}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label style={styles.label}>Sprite ID</label>
      <input
        style={styles.input}
        type="number"
        value={sprite}
        onChange={(e) => setSprite(+e.target.value)}
      />
      <label style={styles.label}>Preview</label>
      <canvas ref={canvasRef} width={64} height={64} style={styles.canvas} />
      <label style={styles.label}>Health</label>
      <input
        style={styles.input}
        type="number"
        value={health}
        onChange={(e) => setHealth(+e.target.value)}
      />
      <label style={styles.label}>Attack</label>
      <input
        style={styles.input}
        type="number"
        value={attack}
        onChange={(e) => setAttack(+e.target.value)}
      />
      <label style={styles.label}>Behavior</label>
      <AsyncSelect
        loadOptions={async () => behaviorOptions}
        value={behavior}
        onChange={(v) => setBehavior(v as NpcBehavior)}
      />
      <label style={styles.label}>Experience</label>
      <input
        style={styles.input}
        type="number"
        value={exp}
        onChange={(e) => setExp(+e.target.value)}
      />
      <div style={styles.actions}>
        <button style={styles.btn} onClick={saveNpc}>
          Save NPC
        </button>
        <button
          style={{ ...styles.btn, ...styles.btnDanger }}
          onClick={removeNpc}
        >
          Delete NPC
        </button>
      </div>
    </div>
  );
};

const styles = {
  group: {
    background: '#f9f9f9',
    borderRadius: 12,
    padding: '18px 15px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: 12,
    border: '1px solid #e9fbe9',
  },
  h3: {
    margin: 0,
    marginBottom: 5,
    color: '#333',
    fontWeight: 700,
    fontSize: '1rem',
    textAlign: 'left' as const,
  },
  label: {
    fontWeight: 600,
    color: '#218c49',
    fontSize: 14,
    marginBottom: 2,
    display: 'block' as const,
  },
  input: {
    width: '100%',
    padding: '9px 10px',
    border: '1.5px solid #a0e0a0',
    borderRadius: 6,
    outline: 'none',
    fontSize: 14,
    background: '#fff',
    marginBottom: 5,
    transition: 'border 0.16s, background 0.16s',
  },
  canvas: {
    border: '1px solid #ccc',
    marginBottom: 8,
    height: '64px',
    width: '64px',
  },
  actions: {
    display: 'flex' as const,
    gap: 10,
    marginTop: 5,
  },
  btn: {
    background: '#2ecc40',
    color: '#fff',
    border: 'none',
    padding: '9px 16px',
    borderRadius: 6,
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    transition: 'background 0.2s',
    flexGrow: 1,
    textAlign: 'center' as const,
  },
  btnDanger: {
    background: '#e74c3c',
  },
};
