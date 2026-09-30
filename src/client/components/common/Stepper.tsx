import { useT } from '../../i18n';

/** How many of a stack, from one to all of it, without a keyboard. */
export const Stepper = ({
  value,
  max,
  onChange,
  label,
}: {
  value: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
}) => {
  const t = useT();
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button
        type="button"
        className="step-button"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
        aria-label={t('stepper.decrease')}
      >
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button
        type="button"
        className="step-button"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
        aria-label={t('stepper.increase')}
      >
        +
      </button>
      <button
        type="button"
        disabled={value >= max}
        onClick={() => onChange(max)}
      >
        {t('stepper.max')}
      </button>
    </span>
  );
};
