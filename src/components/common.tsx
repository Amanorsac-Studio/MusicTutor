import { dbToMeter, METER_FLOOR_DB, type ChannelLevel } from '../lib/audioEngine';

export function Toggle({ value, onChange, label, disabled }: {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`toggle ${value ? 'on' : ''}`}
      aria-label={label}
      aria-pressed={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
    ><span /></button>
  );
}

/** Horizontal level meter driven by a real dBFS reading. */
export function Meter({ level, label }: { level?: ChannelLevel; label?: string }) {
  const value = level?.meter ?? 0;
  return (
    <div
      className={`meter ${level?.clipping ? 'clipping' : ''}`}
      role="meter"
      aria-label={label ?? 'Level'}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={level ? `${level.rms.toFixed(1)} dBFS` : 'silent'}
    >
      <i style={{ width: `${value * 100}%` }} />
    </div>
  );
}

/** Vertical meter for the mixer, with a peak marker. */
export function VerticalMeter({ level, label }: { level?: ChannelLevel; label?: string }) {
  const value = level?.meter ?? 0;
  const peak = level ? dbToMeter(level.peak) : 0;
  return (
    <div
      className={`tall-meter ${level?.clipping ? 'clipping' : ''}`}
      role="meter"
      aria-label={label ?? 'Level'}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={level ? `${level.rms.toFixed(1)} dBFS` : 'silent'}
    >
      <i style={{ height: `${value * 100}%` }} />
      {peak > 0.01 && <u style={{ bottom: `${peak * 100}%` }} aria-hidden="true" />}
    </div>
  );
}

/** Format a dBFS reading for display, showing -∞ at the noise floor. */
export function formatDb(db: number | undefined): string {
  if (db === undefined || db <= METER_FLOOR_DB) return '−∞';
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`;
}
