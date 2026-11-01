import { Input } from "@/components/ui/input";

/**
 * One end of the quiet-hours window: a labelled time input. The shared Input at its standard height (lead decision
 * 10-31 for the shared-control sweep, B44): it was a hand-made 11px pill. Only the width is its own (`w-auto`, the
 * time's natural width), so From and to still sit side by side.
 */
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
      <Input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={`${label}: ${ariaLabel}`}
        className="w-auto min-w-0 font-mono tabular-nums"
      />
    </label>
  );
}
