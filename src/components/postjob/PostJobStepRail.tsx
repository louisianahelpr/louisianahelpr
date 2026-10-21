import { Check } from "lucide-react";

/** The five Post a Job screens, in order (boards 23, 44, 3, 45, 46). */
const STEPS = ["What", "Details", "Price", "When and where", "Review"] as const;

/**
 * Board 166: on desktop the flow's steps sit in a rail on the left. The
 * current step is marked; a step already passed can be reopened (Back keeps
 * what was typed, so going back loses nothing); a step ahead cannot be
 * skipped to. The phone keeps the segmented bar (PostJobStepHeader) instead.
 */
export function PostJobStepRail({ step, onPick }: { step: number; onPick?: (n: number) => void }) {
  return (
    <nav aria-label="Post a job steps" className="hidden lg:block sticky top-6">
      <ol className="space-y-1">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const current = n === step;
          const done = n < step;
          const body = (
            <>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-ds-13 font-semibold tabular-nums ${
                  current ? "border-primary text-foreground" : done ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                }`}
                aria-hidden
              >
                {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : n}
              </span>
              <span className={`text-ds-15 ${current ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{label}</span>
            </>
          );
          const row = `flex w-full items-center gap-3 rounded-full px-3 py-2 text-left ${current ? "bg-muted" : ""}`;
          return (
            <li key={label}>
              {done && onPick ? (
                <button type="button" className={`${row} ctl-tint`} onClick={() => onPick(n)}>
                  {body}
                  <span className="sr-only">, done. Go back to this step</span>
                </button>
              ) : (
                <div className={row} aria-current={current ? "step" : undefined}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
