interface SectionProgressProps {
  detailsComplete: boolean;
  logisticsComplete: boolean;
  budgetComplete: boolean;
}

/**
 * Section progress — orients the poster on the 3-part form. Each
 * segment fills bark once its section's required fields are satisfied.
 */
export function SectionProgress({
  detailsComplete,
  logisticsComplete,
  budgetComplete,
}: SectionProgressProps) {
  const sections = [
    { label: "Details", done: detailsComplete },
    { label: "Logistics", done: logisticsComplete },
    { label: "Budget", done: budgetComplete },
  ];
  const doneCount = sections.filter((s) => s.done).length;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={sections.length}
      aria-valuenow={doneCount}
      aria-label={`Post a task — ${doneCount} of ${sections.length} sections complete`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span
          className="font-serif italic uppercase text-ds-9"
          style={{ color: "hsl(var(--burnt-sienna) / 0.78)", letterSpacing: "0.18em" }}
        >
          Your progress
        </span>
        <span
          className="text-ds-9 font-sans font-semibold tabular-nums uppercase tracking-wider"
          style={{ color: "hsl(var(--olivewood) / 0.6)" }}
        >
          {doneCount}/{sections.length} done
        </span>
      </div>
      <div className="flex items-end gap-2">
        {sections.map((s) => (
          <div key={s.label} className="flex-1 space-y-1">
            <div
              className="h-1.5 rounded-full transition-colors duration-300 ease-ds-out"
              style={{
                background: s.done
                  ? "hsl(var(--bark))"
                  : "hsl(var(--olivewood) / 0.15)",
              }}
            />
            <span
              className="block text-ds-9 font-sans font-semibold uppercase tracking-wider transition-colors"
              style={{
                color: s.done
                  ? "hsl(var(--bark))"
                  : "hsl(var(--olivewood) / 0.5)",
              }}
            >
              {s.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
