import { Check } from "lucide-react";
import { POST_JOB_SCREENS, screenNumber, type PostJobScreen } from "./postJobScreens";

/**
 * Board 166: on desktop the flow's steps sit in a rail on the left. The
 * current step is marked; a step already passed can be reopened (Back keeps
 * what was typed, so going back loses nothing); a step ahead cannot be
 * skipped to. The phone keeps the segmented bar (PostJobStepHeader) instead.
 */
/** `canPick` says which passed screens can be reopened from here (form pages only). */
export function PostJobStepRail({ screen, onPick, canPick }: { screen: PostJobScreen; onPick?: (s: PostJobScreen) => void; canPick?: (s: PostJobScreen) => boolean }) {
  const step = screenNumber(screen);
  return (
    <nav aria-label="Post a job steps" className="hidden lg:block sticky top-6">
      <ol className="space-y-1">
        {POST_JOB_SCREENS.map(({ key, rail: label }, i) => {
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
            <li key={key}>
              {done && onPick && (canPick?.(key) ?? true) ? (
                // One name, built whole: the label span and a separate sr-only ", done…" span read as
                // "What , done." (audit 2026-10-29 A2-L12). The visible label still starts the name.
                <button type="button" className={`${row} ctl-tint`} onClick={() => onPick(key)} aria-label={`${label}, done. Go back to this step`}>
                  {body}
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
