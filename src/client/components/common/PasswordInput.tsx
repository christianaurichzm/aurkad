import { useState, type ComponentProps } from 'react';
import { Icon } from './Icon';
import { useT } from '../../i18n';

// A password the player can read back before sending it: a phone keyboard
// swaps a letter without saying so, and a refused login does not say which.
export const PasswordInput = ({
  style,
  ...props
}: Omit<ComponentProps<'input'>, 'type'>) => {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <span className="password-field">
      <input
        {...props}
        type={shown ? 'text' : 'password'}
        style={{ ...style, paddingRight: 44 }}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={t('auth.showPassword')}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      >
        <Icon name={shown ? 'eye-off' : 'eye'} />
      </button>
    </span>
  );
};
