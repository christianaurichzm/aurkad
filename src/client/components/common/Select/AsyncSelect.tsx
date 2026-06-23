import { useEffect, useState } from 'react';
import { Select } from './Select';

type AsyncSelectOption<T> = {
  value: T;
  label: string;
};

interface AsyncSelectProps<T> {
  loadOptions: () => Promise<AsyncSelectOption<T>[]>;
  value: T;
  onChange: (value: T) => void;
}

export function AsyncSelect<T extends string | number>({
  loadOptions,
  value,
  onChange,
}: AsyncSelectProps<T>) {
  const [options, setOptions] = useState<AsyncSelectOption<T>[]>([]);

  useEffect(() => {
    let active = true;
    (async () => {
      const opts = await loadOptions();
      if (active) setOptions(opts);
    })();
    return () => {
      active = false;
    };
  }, [loadOptions]);

  const handleChange = (val: string) => {
    if (val === '') {
      onChange((typeof value === 'number' ? 0 : '') as T);
      return;
    }
    const selected = options.find((opt) => String(opt.value) === val);
    if (selected) {
      onChange(selected.value);
    }
  };

  return (
    <Select
      options={[
        { value: '', label: '- Select -' },
        ...options.map((o) => ({
          value: String(o.value),
          label: o.label,
        })),
      ]}
      value={String(value)}
      onChange={handleChange}
    />
  );
}
