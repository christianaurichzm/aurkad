import { isInputActive } from '../utils/domHelpers';
import React, { useEffect, useState } from 'react';
import { AudioSettings, getAudioSettings, setAudioSettings } from '../audio';
import {
  changePassword,
  fetchAuthCapabilities,
  fetchEmail,
  httpError,
  passwordMinLength,
  setEmail,
} from '../io/network';
import { colors, radius } from '../theme';
import { Modal } from './common/Modal';
import { escapeClaimed } from '../hooks/useEscapeClose';
import {
  LANGUAGES,
  getLanguage,
  setLanguage,
  useT,
  type Language,
} from '../i18n';

// Client preferences, kept in localStorage by the module owning each one.
// Server settings are the operator's and are not shown here.
export const SettingsModal: React.FC = () => {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [audio, setAudio] = useState<AudioSettings>(getAudioSettings);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordNote, setPasswordNote] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [saving, setSaving] = useState(false);
  // The address section shows only when the server can send mail.
  const [canMail, setCanMail] = useState(false);
  const [email, setEmailValue] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailNote, setEmailNote] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    fetchAuthCapabilities()
      .then((c) => setCanMail(c?.mail === true))
      .catch(() => {});
  }, [visible]);

  useEffect(() => {
    if (!visible || !canMail) return;
    fetchEmail()
      .then((r) => setCurrentEmail(r?.email ?? null))
      .catch(() => {});
  }, [visible, canMail]);

  useEffect(() => {
    const onToggle = () => setVisible((v) => !v);
    window.addEventListener('toggleSettings', onToggle);

    // Escape opens settings when nothing else claims it through
    // useEscapeClose, and never while typing.
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isInputActive())
        return;
      if (escapeClaimed()) return;
      event.preventDefault();
      setVisible(true);
    };
    window.addEventListener('keydown', onEscape);

    return () => {
      window.removeEventListener('toggleSettings', onToggle);
      window.removeEventListener('keydown', onEscape);
    };
  }, []);

  if (!visible) return null;

  const update = (patch: Partial<AudioSettings>) => {
    setAudioSettings(patch);
    setAudio(getAudioSettings());
  };

  const submitPassword = async () => {
    const min = passwordMinLength();
    if (next.length < min) {
      setPasswordError(true);
      return setPasswordNote(t('auth.passwordTooShort', { min }));
    }
    setSaving(true);
    try {
      await changePassword(current, next);
      setPasswordError(false);
      setPasswordNote(t('auth.passwordChanged'));
      setCurrent('');
      setNext('');
    } catch (e) {
      setPasswordError(true);
      setPasswordNote(httpError(e).message || t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const submitEmail = async () => {
    setSaving(true);
    try {
      const result = await setEmail(emailPassword, email);
      setEmailError(!result?.sent);
      setEmailNote(result?.sent ? t('auth.emailSent') : t('auth.emailNotSent'));
      setEmailPassword('');
    } catch (e) {
      setEmailError(true);
      setEmailNote(httpError(e).message || t('common.error'));
    } finally {
      setSaving(false);
    }
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
    <Modal
      title={t('settings.title')}
      onClose={() => setVisible(false)}
      width={380}
    >
      <div style={layout}>
        <div style={sectionTitle}>{t('settings.audio')}</div>
        <label style={row}>
          <input
            type="checkbox"
            checked={audio.muted}
            onChange={(e) => update({ muted: e.target.checked })}
          />
          <span style={rowLabel}>{t('settings.mute')}</span>
        </label>
        {slider(t('settings.music'), 'music')}
        {slider(t('settings.effects'), 'effects')}

        <div style={sectionTitle}>{t('settings.language')}</div>
        <label style={row}>
          <span style={rowLabel}>{t('settings.language')}</span>
          <select
            aria-label={t('settings.language')}
            value={getLanguage()}
            onChange={(e) => setLanguage(e.target.value as Language)}
            style={select}
          >
            {Object.entries(LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>

        {canMail && (
          <>
            <div style={sectionTitle}>{t('settings.email')}</div>
            <span style={note}>
              {currentEmail
                ? t('auth.emailCurrent', { email: currentEmail })
                : t('auth.emailNone')}
            </span>
            <input
              type="email"
              autoComplete="email"
              placeholder={t('auth.emailAddress')}
              value={email}
              onChange={(e) => setEmailValue(e.target.value)}
              style={input}
            />
            <input
              type="password"
              autoComplete="current-password"
              placeholder={t('auth.currentPassword')}
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              style={input}
            />
            <button
              type="button"
              disabled={saving || !email || !emailPassword}
              onClick={() => void submitEmail()}
              className="button-primary"
              style={button}
            >
              {t('auth.saveEmail')}
            </button>
            {emailNote && (
              <span style={emailError ? noteError : note}>{emailNote}</span>
            )}
          </>
        )}

        <div style={sectionTitle}>{t('settings.password')}</div>
        <input
          type="password"
          autoComplete="current-password"
          placeholder={t('auth.currentPassword')}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          style={input}
        />
        <input
          type="password"
          autoComplete="new-password"
          placeholder={t('auth.newPassword')}
          value={next}
          onChange={(e) => setNext(e.target.value)}
          style={input}
        />
        <button
          type="button"
          disabled={saving || !current || !next}
          onClick={() => void submitPassword()}
          className="button-primary"
          style={button}
        >
          {t('auth.changePassword')}
        </button>
        {passwordNote && (
          <span style={passwordError ? noteError : note}>{passwordNote}</span>
        )}
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

const input: React.CSSProperties = {
  padding: '9px 11px',
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  background: colors.surface,
  fontSize: 14,
  boxSizing: 'border-box',
  width: '100%',
};

const button: React.CSSProperties = { padding: '9px 12px', fontSize: 14 };

const note: React.CSSProperties = { fontSize: 13, color: colors.textMuted };

const noteError: React.CSSProperties = { fontSize: 13, color: colors.danger };

const row: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: colors.surfaceMuted,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  padding: '10px 12px',
  cursor: 'pointer',
};

const select: React.CSSProperties = {
  marginLeft: 'auto',
  background: colors.surface,
  color: colors.text,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.control,
  padding: '4px 8px',
  fontSize: 14,
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
