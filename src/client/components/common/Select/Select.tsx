export interface SelectOption {
  value: string;
  label: string;
}
export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  onFocus?: React.FocusEventHandler<HTMLSelectElement>;
  onBlur?: React.FocusEventHandler<HTMLSelectElement>;
}

export const Select: React.FC<SelectProps> = ({
  options,
  value,
  onChange,
  onFocus,
  onBlur,
}) => (
  <select
    value={value || ''}
    onChange={(e) => onChange?.(e.target.value)}
    onFocus={onFocus}
    onBlur={onBlur}
  >
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
);
