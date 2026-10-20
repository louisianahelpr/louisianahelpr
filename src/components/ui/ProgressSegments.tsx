/**
 * THE progress tracker (spec v2 §3 "Progress tracker (one component)"): 3-6
 * olive segments, done and current filled, the rest on the quiet line, with
 * each step's name under its segment and the current one in bold. Step names
 * come from the real state machine of whatever is tracked; this component
 * only draws them.
 */
export function ProgressSegments({ steps, current, label }: { steps: readonly string[]; current: number; label: string }) {
  return (
    <div data-progress-segments role="img" aria-label={`${label}: step ${current + 1} of ${steps.length}, ${steps[current]}`} className="grid gap-x-1.5 gap-y-1" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((s, i) => (
        <span key={`bar-${s}`} aria-hidden className={`h-1 rounded-full ${i <= current ? "bg-primary" : "bg-muted"}`} />
      ))}
      {steps.map((s, i) => (
        <span key={`name-${s}`} aria-hidden className={`text-ds-12 truncate ${i === current ? "font-bold text-foreground" : "text-muted-foreground"}`}>
          {s}
        </span>
      ))}
    </div>
  );
}
