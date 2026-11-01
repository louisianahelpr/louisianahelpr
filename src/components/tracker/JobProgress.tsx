import { AlertTriangle, CalendarCheck, Check, CheckCircle2, Clock, FileText, Hand, Hourglass, MapPin, PartyPopper, Truck, Wrench, XCircle, type LucideIcon } from "lucide-react";
import { useStepTooltip } from "@/hooks/useStepTooltip";
import { JOB_PROGRESS_DRAWN, JOB_PROGRESS_SHORT, JOB_PROGRESS_STEPS, type JobProgressState, type Stage, type StepTone } from "@/components/tracker/jobProgressState";

/**
 * THE job tracker (owner, 2026-10-21: "we need 1 tracker"; 8 steps, 2026-10-22): Posted · Offered · Hired ·
 * Confirmed · On the way · Arrived · Working · Done, then one line saying what happens next. Chat, the job page,
 * Home and both job cards render this and nothing else; the state comes from `jobProgress`
 * (src/components/tracker/jobProgressState.ts), whose current step is the CARD's own state (src/components/tracker/jobStepFromWait.ts).
 *
 * Colour (owner): done steps GREEN; the current step AMBER (2026-10-23, the old rail's rule: one "you are here"
 * colour), with a hand when it waits on the viewer and an hourglass when it waits on the other person; later steps
 * grey. ON THE WAY, ARRIVED AND WORKING (owner, 2026-10-31: "it should be white right now while we wait"): WHITE
 * (the later-step outline, still with its hand / hourglass and bold word) until that step has begun, the app's
 * bright YELLOW (--live-pill-tint) while it is happening, filled when done (JobProgressState.begun). A no-show or an overdue job puts the step it never got past in the warning
 * colour with an alert icon and its own word ("No-show?", "Overdue"); a dispute is RED on its step (the old rail's
 * rule: "red is ONLY the step that went wrong"); a cancelled job is all grey with "Cancelled" under it. Colour is
 * never the only signal: the current step carries an icon (a hand for "your move", an hourglass for "theirs") and
 * the bold label, done steps a check from 640px, later steps an empty outline, and the whole bar reads as one
 * sentence to a screen reader.
 *
 * THE OLD RAIL'S STEPS ARE KEPT (owner, 2026-10-23: "all the steps i built on our previous tracker ... back"): the
 * full tracker (job page, the open card, chat; not the collapsed card's bar) draws each step's own icon (the
 * eight icons of JobTracking's STATUSES), a tap or hover on a done step shows when it happened (useStepTooltip,
 * the old rail's stamps), a tap on the current step says why it is that colour (the line), and the current step
 * pulses until the job is done (never on a problem or a finished job; a span, never a control).
 * Guards: src/test/oneJobTracker.test.ts, src/test/trackerKeepsTheOldSteps.test.tsx.
 */
type StepState = "done" | "you" | "them" | "problem" | "alarm" | "todo";

/** Each step's icon, the old rail's (JobTracking STATUSES / PRE_STATUSES), in JOB_PROGRESS_STEPS order. */
export const JOB_STEP_ICONS: readonly LucideIcon[] = [FileText, Clock, CheckCircle2, CalendarCheck, Truck, MapPin, Wrench, PartyPopper];

const BAR: Record<StepState, string> = {
  // Done steps are the app's olive (owner 2026-10-25: "the green on the tracker needs to match our green").
  done: "bg-[hsl(var(--bark))]",
  // THE CURRENT STEP IS ALWAYS AMBER (owner, 2026-10-23: the old rail's rule wins over the 10-22 yellow/olive
  // split). Whose move it is stays on the step as its icon (a hand for yours, an hourglass for theirs) and in the
  // line and the aria sentence.
  you: "bg-[hsl(var(--amber-solid))]",
  them: "bg-[hsl(var(--amber-solid))]",
  problem: "bg-[hsl(var(--burnt-sienna))]",
  alarm: "bg-destructive",
  todo: "border border-border bg-transparent",
};
/** On the way / Arrived / Working as the current step (JobProgressState.begun): WHITE while it waits to begin
 *  (the later-step outline), the app's bright yellow while it is happening (owner 2026-10-31). */
type Phase = "waiting" | "happening";
const PHASE_BAR: Record<Phase, string> = {
  waiting: BAR.todo,
  happening: "bg-[hsl(var(--live-pill-tint))]",
};
const PHASE_TEXT: Record<Phase, string> = {
  waiting: "font-semibold text-foreground",
  happening: "font-semibold text-[hsl(var(--live-pill-ink))]",
};
const TEXT: Record<StepState, string> = {
  done: "text-[hsl(var(--bark))]",
  you: "font-semibold text-[hsl(var(--amber-ink))]",
  them: "font-semibold text-[hsl(var(--amber-ink))]",
  problem: "font-semibold text-[hsl(var(--sienna-ink))]",
  alarm: "font-semibold text-destructive-ink",
  todo: "text-muted-foreground",
};

/** One problem word at every width, short enough for its column at 375 (JOBS2-38: "Overdue" at 1440 and "Late" at 375 for one step). The aria sentence keeps the full word. */
const PROBLEM_SHORT: Record<string, string> = { "No-show?": "No-show", Overdue: "Late", Dispute: "Issue" };

/** "Oct 22, 3:00 PM": when a done step happened. */
const stampText = (ts: string) => new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The bar as one sentence: every step's full name and where the job is. */
export function jobStepsLabel(stage: Stage, waitingOnYou: boolean, tone: StepTone = "progress", label?: string): string {
  const n = JOB_PROGRESS_STEPS.length;
  if (tone === "cancelled") return `Job progress: ${label ?? "Cancelled"}. No steps ahead.`;
  if (stage >= n) return `Job progress: all ${n} steps done (${JOB_PROGRESS_STEPS.join(", ")}).`;
  const done = JOB_PROGRESS_STEPS.slice(0, stage);
  const later = JOB_PROGRESS_STEPS.slice(stage + 1);
  return [
    `Job progress, step ${stage + 1} of ${n}: ${(JOB_PROGRESS_STEPS as readonly string[])[stage]}, ${tone === "problem" ? `${label ?? "needs attention"}, needs attention` : waitingOnYou ? "waiting on you" : "waiting on the other person"}.`,
    done.length ? `Done: ${done.join(", ")}.` : "",
    later.length ? `Still to come: ${later.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

function JobStepBar({ stage, waitingOnYou, tone = "progress", label, detailed = false, stamps, why, begun }: {
  stage: Stage;
  waitingOnYou: boolean;
  tone?: StepTone;
  label?: string;
  /** The full tracker: step icons, tap/hover times on done steps, a tap on the current step, the pulse. */
  detailed?: boolean;
  stamps?: readonly (string | null)[];
  /** What the current step is waiting on (the tracker's line), shown when the current step is tapped. */
  why?: string;
  /** JobProgressState.begun: the current On the way / Arrived / Working has started (yellow) or not (white). */
  begun?: boolean;
}) {
  const tip = useStepTooltip();
  const phase: Phase | null = tone === "progress" && stage >= 4 && stage <= 6 && begun !== undefined ? (begun ? "happening" : "waiting") : null;
  const current: StepState = tone === "problem" ? (label === "Dispute" ? "alarm" : "problem") : waitingOnYou ? "you" : "them";
  const states: StepState[] = JOB_PROGRESS_STEPS.map((_, i) =>
    tone === "cancelled" ? "todo" : i < stage ? "done" : i === stage ? current : "todo");
  if (tone === "cancelled") {
    return (
      <div role="img" aria-label={jobStepsLabel(stage, false, tone, label)} data-job-steps="" data-stage={stage} data-tone={tone}>
        <div className="grid grid-cols-8 gap-1" aria-hidden="true">
          {JOB_PROGRESS_STEPS.map((full) => <span key={full} data-step-state="todo" className={`block h-1.5 rounded-full ${BAR.todo}`} />)}
        </div>
        <span className="mt-1 flex items-center gap-1 text-ds-11 font-semibold leading-tight text-muted-foreground" aria-hidden="true">
          <XCircle className="h-3 w-3 shrink-0" />
          {label ?? "Cancelled"}
        </span>
      </div>
    );
  }
  // The current step pulses while the job is live (the old rail's railStepPulses: not on Done, not on a problem).
  // A step still waiting to begin is drawn like a later one (white), so it does not pulse either.
  const pulses = detailed && tone === "progress" && stage < JOB_PROGRESS_STEPS.length && phase !== "waiting";
  return (
    <div
      // The full tracker is a group (its done and current steps are tappable); the card's bar is one image. Both are
      // named by the one sentence. The one-row guard reads the tracker as content, not as the card's moves.
      role={detailed ? "group" : "img"}
      aria-label={jobStepsLabel(stage, waitingOnYou, tone, label)}
      data-job-steps=""
      data-stage={stage}
      data-tone={tone}
      data-waiting-on={stage < JOB_PROGRESS_STEPS.length && tone === "progress" ? (waitingOnYou ? "you" : "them") : "none"}
      className="job-steps-grid grid gap-1"
      // The current step gets a wider column so its icon and word fit eight across at 375; from 640px, eight equal.
      style={{ gridTemplateColumns: states.map((s) => (s === "problem" || s === "alarm" ? "minmax(0,2fr)" : s === "you" || s === "them" ? "minmax(0,1.5fr)" : "minmax(0,1fr)")).join(" ") }}
    >
      {JOB_PROGRESS_STEPS.map((full, i) => {
        const s = states[i];
        const stepPhase = i === stage ? phase : null;
        const barCls = stepPhase ? PHASE_BAR[stepPhase] : BAR[s];
        const textCls = stepPhase ? PHASE_TEXT[stepPhase] : TEXT[s];
        const Icon = JOB_STEP_ICONS[i];
        const ts = s === "done" ? stamps?.[i] ?? null : null;
        // A done step with a time, or the current step with a reason, is a control (full tracker only).
        const tipText = !detailed ? null : ts ? stampText(ts) : i === stage && why ? why : null;
        const key = `step-${i}`;
        const body = (
          <>
            {detailed && (
              <span className="mb-0.5 flex justify-center" data-step-icon="">
                <Icon className={`h-3.5 w-3.5 ${textCls}`} strokeWidth={1.75} aria-hidden />
              </span>
            )}
            <span data-step-seg="" className={`block h-1.5 rounded-full ${barCls} ${pulses && i === stage ? "step-current-pulse" : ""}`} />
            <span className={`mt-1 flex min-w-0 items-center justify-center gap-0.5 text-ds-11 leading-tight ${textCls}`}>
              {/* `job-step-cur-icon`: a tracker under 260px wide (/payment-success and job cards at 320) drops it so every word
                  fits; the amber fill and the bold word still mark the current step (index.css, audit F17). */}
              {s === "you" && <Hand className="job-step-cur-icon h-3 w-3 shrink-0" />}
              {s === "them" && <Hourglass className="job-step-cur-icon h-3 w-3 shrink-0" />}
              {/* From 640px only: at 375 the word ("No-show") needs the whole column; the fill, the bold word and
                  the status line above it carry the signal there. */}
              {(s === "problem" || s === "alarm") && <AlertTriangle className="job-step-wide h-3 w-3 shrink-0" />}
              {s === "done" && <Check className="job-step-wide h-3 w-3 shrink-0" />}
              <span className="job-step-short truncate">{(s === "problem" || s === "alarm") && label ? PROBLEM_SHORT[label] ?? label : JOB_PROGRESS_SHORT[i]}</span>
              {/* The full name may take two lines (a soft hyphen or its space), never an ellipsis (A2-L15). */}
              <span className="job-step-full min-w-0 text-center">{(s === "problem" || s === "alarm") && label ? PROBLEM_SHORT[label] ?? label : JOB_PROGRESS_DRAWN[i]}</span>
            </span>
          </>
        );
        return (
          <div key={full} data-step-state={s} {...(stepPhase ? { "data-step-phase": stepPhase } : {})} className="relative min-w-0">
            {tipText ? (
              <button
                type="button"
                data-step-tip={i}
                // A done step names its time; the current step names what its tap shows, not the line itself (the
                // line is already on screen, and its words must not read as one of the card's own buttons).
                aria-label={ts ? `${full} — ${tipText}` : `${full}: what this step is waiting on`}
                {...tip.handlers(key)}
                // THE HIT AREA REACHES INTO HALF THE GAP ON EACH SIDE (Q2369): eight steps share one row at 375
                // (owner, 2026-10-22), so a column is ~43px in CI's fonts, under the 44px tap target. The grid's gap
                // is 4px (gap-1 above), so the button is 4px wider than its column with -2px margins: 2px of the gap
                // on each side, which a neighbour never claims (it takes its own 2px), so targets meet and never
                // overlap. px-[2px] keeps the step's icon, bar and word exactly where they were. The row's layout
                // does not change. Guard: e2e/happy-path/messages-thread.spec.ts (44px, no overlap).
                // flex-col justify-start: a <button> CENTRES its content in the 44px, so a step with a time sat ~2px
                // lower than a plain step beside it (owner 2026-10-25, "step labels uneven"; measured 188.3 vs 186.1
                // on the job page). Top-aligned, every step's icon, bar and word share one line.
                // Guard: src/test/jobStepsEvenRow.test.ts.
                className="flex flex-col justify-start w-[calc(100%+4px)] -mx-[2px] px-[2px] min-h-[44px] !min-w-0 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--bark))]"
              >
                <span aria-hidden="true" className="block">{body}</span>
              </button>
            ) : (
              <div aria-hidden="true">{body}</div>
            )}
            {tipText && tip.open === key && (
              <div
                role="tooltip"
                className={`absolute top-full z-20 mt-1 w-max max-w-[14rem] whitespace-normal rounded-ds-md px-2 py-1 text-ds-10 font-semibold ${i > 4 ? "right-0" : "left-0"}`}
                style={{ background: "hsl(var(--ink-deep))", color: "hsl(var(--parchment))", boxShadow: "0 4px 14px -4px hsl(var(--ink-deep) / 0.4)" }}
              >
                {tipText}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function JobProgress({ progress, compact = false, barOnly = false, noLine = false }: {
  progress: JobProgressState;
  compact?: boolean;
  /** The bar alone (a job card, whose status line already says what happens next). */
  barOnly?: boolean;
  /** The bar with its step tips, but no line under it: the caller draws the next step itself (chat's DealCard). */
  noLine?: boolean;
}) {
  const line = barOnly || noLine ? "" : progress.next || (progress.stage === null ? progress.word : "");
  if (progress.stage === null && !line) return null;
  return (
    <div data-job-progress="" className="job-steps space-y-1.5">
      {progress.stage !== null && (
        <JobStepBar
          stage={progress.stage}
          waitingOnYou={progress.waitingOnYou}
          tone={progress.tone}
          label={progress.label}
          detailed={!barOnly}
          stamps={progress.stamps}
          why={progress.next || undefined}
          begun={progress.begun}
        />
      )}
      {line && (
        <p data-job-progress-next="" className={`${compact ? "text-ds-12" : "text-ds-13"} text-muted-foreground`}>
          {progress.stage === null && progress.word && progress.next ? (
            <>
              <span className="font-semibold text-foreground">{progress.word}</span> · {progress.next}
            </>
          ) : (
            line
          )}
        </p>
      )}
    </div>
  );
}
