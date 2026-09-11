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
          // Keyed by position: before capture permission is granted the browser
          // reports every device with an empty id, so values are not unique.
          options.map((option, index) => (
            <option key={`${option.value}-${index}`} value={option.value} disabled={option.disabled}>
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
  // A distinct sentinel, because an unpermitted device also reports an empty id
  // and would otherwise be indistinguishable from "not assigned".
  if (allowNone && options.length) options.unshift({ value: NONE_VALUE, label: noneLabel });
  return (
    <Select
      value={allowNone && !value ? NONE_VALUE : value}
      options={options}
      onChange={next => onChange(next === NONE_VALUE ? '' : next)}
      label={label}
      emptyLabel={emptyLabel}
    />
  );
}

const NONE_VALUE = '__none__';
