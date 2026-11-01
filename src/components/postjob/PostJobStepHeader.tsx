import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPostJob";
import { POST_JOB_SCREENS, POST_JOB_SCREEN_COUNT as POST_JOB_STEP_COUNT, screenNumber, type PostJobScreen } from "./postJobScreens";

interface Props {
  /** Which screen this is; its number comes from POST_JOB_SCREENS (one source). */
  screen: PostJobScreen;
  /** The one question this screen asks (Bodoni: a flow question, spec §1.2). */
  question: string;
  /** One muted line under the question. */
  helper: string;
  /** Reopen a step already passed (the same rule as the desktop PostJobStepRail). Absent: the bar is display only. */
  onPick?: (s: PostJobScreen) => void;
  /** Which passed screens can be reopened from here. */
  canPick?: (s: PostJobScreen) => boolean;
}

/**
 * The head of every Post a Job screen (boards 23, 44, 3, 45, 46; step 0 and 1b since 2026-10-21): a segmented
 * progress bar with "n of 7", then the screen's question and one helper line.
 */
export function PostJobStepHeader({ screen, question, helper, onPick, canPick }: Props) {
  const step = screenNumber(screen);
  // Post a job in Spanish (A3-3): re-renders when the language or its words arrive.
  const { t } = useLanguage();
  return (
    <header className="space-y-4">
      {/* Desktop shows the step rail instead (board 166, PostJobStepRail). */}
      <div className="flex items-center gap-3 lg:hidden">
        <div
          role="progressbar"
          aria-label={t("postJob.progress")}
          aria-valuemin={1}
          aria-valuemax={POST_JOB_STEP_COUNT}
          aria-valuenow={step}
          aria-valuetext={t("postJob.stepOfLong", { step, count: POST_JOB_STEP_COUNT })}
          className="flex flex-1 gap-1.5"
        >
          {Array.from({ length: POST_JOB_STEP_COUNT }, (_, i) => {
            const seg = <span className={`block h-1 w-full rounded-full ${i < step ? "bg-primary" : "bg-border"}`} />;
            const key = POST_JOB_SCREENS[i]?.key;
            // A step already passed is tappable on the phone too (owner 2026-10-25: "make the stepper
            // clickable to go back"), like the desktop rail. Back keeps what was typed. The button's 44px
            // height is the tap target; the visible segment stays the thin bar.
            return i + 1 < step && key && onPick && (canPick?.(key) ?? true) ? (
              <button
                key={i}
                type="button"
                data-done=""
                data-step-pick={key}
                aria-label={t("postJob.goBackToStep", { step: i + 1 })}
                onClick={() => onPick(key)}
                className="flex-1 basis-0 -my-5 flex min-h-[44px] !min-w-0 items-center p-0"
              >
                {seg}
              </button>
            ) : (
              <span key={i} data-done={i < step ? "" : undefined} className="flex-1 basis-0 flex items-center">
                {seg}
              </span>
            );
          })}
        </div>
        <span className="shrink-0 font-sans text-ds-13 font-semibold tabular-nums text-muted-foreground" aria-hidden>
          {t("postJob.stepOf", { step, count: POST_JOB_STEP_COUNT })}
        </span>
      </div>
      <div className="space-y-1.5">
        <h2 className="font-display font-moment text-ds-32 font-semibold text-foreground">{question}</h2>
        <p className="font-sans text-ds-15 text-muted-foreground">{helper}</p>
      </div>
    </header>
  );
}
