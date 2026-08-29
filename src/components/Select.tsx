/**
 * A real select control. The previous build rendered a `<button>` with a
 * chevron and no menu, which is why every control looked disabled.
 */

import { ChevronDown } from 'lucide-react';

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  /** Shown as the only option when `options` is empty. */
  emptyLabel?: string;
  label: string;
  disabled?: boolean;
  className?: string;
};

export function Select({
  value, options, onChange, emptyLabel = 'No devices found', label, disabled, className = '',
}: SelectProps) {
  const isEmpty = options.length === 0;
  return (
    <span className={`select-wrap ${className} ${isEmpty ? 'is-empty' : ''}`}>
      <select
        className="select-box"
        aria-label={label}
        disabled={disabled || isEmpty}
        value={isEmpty ? '__empty__' : value}
        onChange={event => onChange(event.target.value)}
      >
        {isEmpty ? (
          <option value="__empty__">{emptyLabel}</option>
        ) : (
          options.map(option => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))
        )}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </span>
  );
}

/** Convenience wrapper for a list of `{id, name}` devices. */
export function DeviceSelect({
  devices, value, onChange, label, emptyLabel, allowNone, noneLabel = 'None',
}: {
  devices: Array<{ id: string; name: string }>;
  value: string;
  onChange: (value: string) => void;
  label: string;
  emptyLabel?: string;
  allowNone?: boolean;
  noneLabel?: string;
}) {
  const options: SelectOption[] = devices.map(device => ({ value: device.id, label: device.name }));
  if (allowNone && options.length) options.unshift({ value: '', label: noneLabel });
  return (
    <Select
      value={value}
      options={options}
      onChange={onChange}
      label={label}
      emptyLabel={emptyLabel}
    />
  );
}
