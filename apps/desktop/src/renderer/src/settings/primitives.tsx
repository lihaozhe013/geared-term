import type { ReactNode } from 'react';

export function Section({
  title,
  children
}: {
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="settings-section">
      <h2 className="settings-section-title">{title}</h2>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function Row({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <label>{label}</label>
      {children}
      {hint ? <p className="settings-hint">{hint}</p> : null}
    </div>
  );
}

export function InlineRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="settings-row-inline">
      <span className="settings-row-inline-label">{label}</span>
      {children}
    </div>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  format,
  onChange
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  return (
    <div className="stepper">
      <button
        type="button"
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(clamp(Math.round((value - step) * 100) / 100))}
      >
        −
      </button>
      <span className="stepper-value">{format ? format(value) : value}</span>
      <button
        type="button"
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => onChange(clamp(Math.round((value + step) * 100) / 100))}
      >
        +
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange
}: {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <div className="segmented" role="group">
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={option.value === value ? 'active' : ''}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
