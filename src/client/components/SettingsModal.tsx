import React, { useEffect, useState } from 'react';
import { AudioSettings, getAudioSettings, setAudioSettings } from '../audio';
import { colors, radius } from '../theme';
import { Modal } from './common/Modal';

// Client preferences, kept in localStorage by the module owning each one.
// Server settings are the operator's and are not shown here.
export const SettingsModal: React.FC = () => {
  const [visible, setVisible] = useState(false);
  const [audio, setAudio] = useState<AudioSettings>(getAudioSettings);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleSettings', onToggle);
    return () => window.removeEventListener('toggleSettings', onToggle);
  }, []);

  if (!visible) return null;

  const update = (patch: Partial<AudioSettings>) => {
    setAudioSettings(patch);
    setAudio(getAudioSettings());
  };

  const slider = (
    label: string,
    key: 'music' | 'effects',
  ): React.ReactElement => (
    <label style={row}>
      <span style={rowLabel}>{label}</span>
      <input
        type="range"
        // The wrapping label reads as "Music 40%", so the name is explicit.
        aria-label={label}
        min={0}
        max={1}
        step={0.05}
        value={audio[key]}
        disabled={audio.muted}
        onChange={(e) => update({ [key]: Number(e.target.value) })}
        style={{ flex: 1, accentColor: colors.primary }}
      />
      <span style={value}>{Math.round(audio[key] * 100)}%</span>
    </label>
  );

  return (
    <Modal title="Settings" onClose={() => setVisible(false)} width={380}>
      <div style={layout}>
        <div style={sectionTitle}>Audio</div>
        <label style={row}>
          <input
            type="checkbox"
            checked={audio.muted}
            onChange={(e) => update({ muted: e.target.checked })}
          />
          <span style={rowLabel}>Mute everything</span>
        </label>
        {slider('Music', 'music')}
        {slider('Effects', 'effects')}
      </div>
    </Modal>
  );
};

const layout: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const sectionTitle: React.CSSProperties = {
  color: colors.textMuted,
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
};

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: '10px 12px',
  cursor: 'pointer',
};

const rowLabel: React.CSSProperties = {
  color: colors.text,
  fontSize: 14,
  fontWeight: 600,
  minWidth: 64,
};

const value: React.CSSProperties = {
  color: colors.textMuted,
  fontSize: 13,
  fontWeight: 700,
  minWidth: 40,
  textAlign: 'right',
};
