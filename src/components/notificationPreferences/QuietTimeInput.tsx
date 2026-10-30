/** One end of the quiet-hours window: a labelled time input. */
export function QuietTimeInput({ label, ariaLabel, value, onChange, disabled }: {
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
      <span className="font-sans">{label}</span>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="rounded-ds-sm border border-border/40 bg-card px-2 py-1 text-ds-11 font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );
}
