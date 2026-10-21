/**
 * THE progress tracker (spec v2 §3 "Progress tracker (one component)"): 3-6
 * olive segments with every step named and the current one in bold. Jobs
 * (Posted -> Hired -> Working -> Done) and Helpr delivery (Booked -> Picked up
 * -> Delivered) draw this same bar; only the step names change, and they come
 * from the real state machine at each call site.
 */
export function StepTracker({ steps, at }: { steps: readonly string[]; at: number }) {
  return (
    <ol
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      aria-label={`Step ${at + 1} of ${steps.length}: ${steps[at]}`}
    >
      {steps.map((label, i) => (
        <li key={label} className="min-w-0">
          <span aria-hidden className={`block h-1 rounded-full ${i <= at ? "bg-primary" : "bg-muted"}`} />
          <span className={`mt-1.5 block truncate text-ds-12 ${i === at ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
        </li>
      ))}
    </ol>
  );
}
