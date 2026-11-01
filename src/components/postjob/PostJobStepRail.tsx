import { Check } from "lucide-react";
import { useLanguage } from "@/lib/i18n/language";
import "@/lib/i18n/enPostJob";
import type { MsgKey } from "@/lib/i18n/en";
import { POST_JOB_SCREENS, screenNumber, type PostJobScreen } from "./postJobScreens";

/**
 * Board 166's desktop columns, shared by every Post a Job screen that shows the rail (the form steps
 * and Review): step rail left, the step centred (max 640px), the "How your post will look" card right.
 * The card joins at xl, not lg (lead, 2026-10-25): beside the 248px app rail the three columns left the
 * form about 215px at 1024 and 370px at 1180 (measured). The phone is the one centred column.
 */
export const POST_JOB_DESKTOP_GRID =
  "mx-auto w-full max-w-2xl lg:max-w-none lg:grid lg:grid-cols-[200px_minmax(0,640px)] xl:grid-cols-[200px_minmax(0,640px)_280px] lg:justify-center lg:items-start lg:gap-section";

/**
 * Board 166: on desktop the flow's steps sit in a rail on the left. The
 * current step is marked; a step already passed can be reopened (Back keeps
 * what was typed, so going back loses nothing); a step ahead cannot be
 * skipped to. The phone keeps the segmented bar (PostJobStepHeader) instead.
 */
/** `canPick` says which passed screens can be reopened from here (form pages only). */
export function PostJobStepRail({ screen, onPick, canPick }: { screen: PostJobScreen; onPick?: (s: PostJobScreen) => void; canPick?: (s: PostJobScreen) => boolean }) {
  const step = screenNumber(screen);
  const { t } = useLanguage();
  return (
    <nav aria-label={t("postJob.steps")} className="hidden lg:block sticky top-6">
      <ol className="space-y-1">
        {POST_JOB_SCREENS.map(({ key }, i) => {
          // The rail word in the member's language (A3-3); POST_JOB_SCREENS.rail is its English.
          const label = t(`postJob.rail.${key}` as MsgKey);
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
                <button type="button" className={`${row} ctl-tint`} onClick={() => onPick(key)} aria-label={t("postJob.railDone", { label })}>
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
