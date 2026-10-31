import { useEffect, useState } from "react";
import { offerIdentityCheckAfterConfirm } from "@/lib/identityCheck";
import { NudgeConfirmLink } from "@/components/job-card/NudgeConfirmLink";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHero,
  DialogCallout,
  DialogFooter,
  DialogSecondaryAction,
  DialogPrimaryAction,
} from "@/components/ui/dialog";
import { CheckCircle2, CalendarClock } from "lucide-react";
import { CONFIRM_DEADLINE_HOURS_BEFORE_START, confirmDeadlineMs, confirmOpensMs, jobDayStart, posterConfirmClosesMs } from "@/lib/jobDate";
import { jobStartDateTime } from "@/lib/dateUtils";
import { slotLabel } from "@/components/tracker/jobProgressState";
import { JOB_TIMEZONE } from "../../supabase/functions/_shared/cancellationFee";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { unwrapMutation, mutationErrorMessage, isWriteRejected } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import { recordConfirmInActivityCache } from "@/lib/confirmActivityCache";
import { JobStepRowSlot } from "@/components/job-card/jobStepRow";
// The row's own done-state surface, so the poster's "already confirmed" box
// matches the Tipped / Reviewed boxes rather than inventing a fourth grey.
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";
import { helperDayOfConfirmation } from "@/components/job-card/helperDayOfConfirmation";
import { takeFaceAction } from "@/components/job-card/faceActionRequest";
import { posterConfirmWarning } from "./posterConfirmWarning";

/** The Helpr's day-before step, on its button (owner, 2026-10-08). */
const HELPER_CONFIRM_LABEL = "Confirm you'll be at the job";
export { helperDayOfConfirmation };

export function JobConfirmation({
  jobId,
  isOwner,
  isHelper,
  posterConfirmedAt,
  helperConfirmedAt,
  helperDayofConfirmedAt = null,
  dateNeeded,
  startTime = null,
  jobStatus,
  helperOnTheWayAt,
  helperArrivedAt = null,
  onConfirm,
  onCantMakeIt,
  variant = "card",
  embedded = false,
  hideNotYetOpen = false,
  otherFirstName = null,
  rescheduled = false,
  jobTitle = null,
  openNow = false,
}: {
  jobId: string;
  isOwner: boolean;
  isHelper: boolean;
  posterConfirmedAt: string | null;
  helperConfirmedAt: string | null;
  /** The helper's DAY-BEFORE stamp (migration 20260824213000). Distinct from
   *  `helper_confirmed_at`, which is written at accept time — possibly days
   *  early — and therefore can't answer "are you still on?". */
  helperDayofConfirmedAt?: string | null;
  dateNeeded: string;
  /** The job's start time, for the day-before window (helperDayOfConfirmation). */
  startTime?: string | null;
  jobStatus?: string;
  helperOnTheWayAt?: string | null;
  /** The Helpr's "I've arrived" stamp (hands the poster's row to the arrival confirm). */
  helperArrivedAt?: string | null;
  onConfirm?: () => void;
  /**
   * Opens the caller's existing cancel/decline flow (CancellationDialog for
   * posters, the helper_cancel_booking confirm for Helprs) — this component
   * has no backend logic of its own for backing out. Omitted where the
   * caller has no such flow to hand back to (e.g. ActiveJobSection, where
   * the job is already day-of and past the point of backing out).
   */
  onCantMakeIt?: () => void;
  /**
   * `"card"` (default) is the standalone glass card with its own heading,
   * date line and the two You/Other status chips — unchanged, and still what
   * the poster's card renders.
   *
   * `"inline"` is for a caller that has MERGED this step into its own tracker
   * panel (the helper's My Jobs card). Owner, 2026-08-30: "bottom box needs to
   * be merged in the live tracker" and "remove you posted confirmed etc." — so
   * inline drops the chrome, the heading, the "Tap to let the other party know
   * it's a go" line, the repeated date and BOTH status chips, and renders only
   * the control. The tracker rail it now sits inside already says which step
   * the job is on; the chips restated that in a second vocabulary, which is the
   * duplication the merge exists to remove.
   */
  variant?: "card" | "inline";
  /** Card variant without its own `rounded-2xl liquid-glass p-3` chrome, for a
   *  caller that already sits inside a card (the poster's PostedJobCard, inside
   *  JobCardShell). The heading, date and chips stay; only the box goes.
   *  `src/test/noNestedTrackerCard.test.ts` enforces it at every call site. */
  embedded?: boolean;
  /** The card draws the "Confirmation opens in" clock itself, as a row of its
   *  CountdownRows beside "until the job starts" (owner, 2026-10-07, Q1399:
   *  every clock on the card in one place, one format, soonest first). See
   *  confirmationOpensClock in
   *  src/components/job-card/confirmationOpensClock.ts. */
  hideNotYetOpen?: boolean;
  /** The other side's first name, for the poster's status line ("Yusef confirms the day before"). */
  otherFirstName?: string | null;
  /** The date or time was moved by an accepted change (useJobRescheduled, owner 2026-10-21): both sides
   *  confirm the NEW slot, and the words say so ("Confirm the new time, Thu 9:00 AM"). */
  rescheduled?: boolean;
  /** The job's name, shown first in the confirm sheet so the member knows WHICH job they confirm (owner 2026-10-31, LEAD-CONFIRM-WORDS / LEAD-JOBPAGE-LAYOUT). */
  jobTitle?: string | null;
  /** Open the confirm sheet as soon as it can (the job page's "Confirm it's still on", LEAD-JOBPAGE-LAYOUT): the
   *  caller remounts it per tap. Same owed-and-open rule as the card's face request. */
  openNow?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [localConfirmedAt, setLocalConfirmedAt] = useState<string | null>(null);
  // A minute tick, so the "opens in" clock below actually counts (else it sits on a stale number).
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  void tick;
  // The collapsed card's face asked for this confirm (faceActionRequest, owner 2026-10-23): open the SAME dialog
  // this card's own button opens, only while the confirm is open and still owed by this viewer.
  useEffect(() => {
    const owed = !(isOwner ? posterConfirmedAt : helperDayofConfirmedAt) && Date.now() >= confirmOpensMs(dateNeeded);
    if (owed && (openNow || takeFaceAction(jobId, "confirm"))) setShowConfirmDialog(true);
  }, [jobId, isOwner, posterConfirmedAt, helperDayofConfirmedAt, dateNeeded, openNow]);

  const jobDate = jobDayStart(dateNeeded);
  const now = new Date();
  const hoursUntilJob = (jobDate.getTime() - now.getTime()) / (1000 * 60 * 60);
  // ONE window, ONE deadline (Q1647, _shared/confirmDeadline.ts): on at midnight the day before, owed until T-2h.
  const opensMs = confirmOpensMs(dateNeeded);
  const confirmOpen = now.getTime() >= opensMs;
  const deadlineMs = confirmDeadlineMs(dateNeeded, startTime);

  /* THE HELPER'S card hides once they are on the way or beyond: they have
     answered "still on?" with their feet, and the tracker below takes over.
     Unchanged.

     THE POSTER'S DOES NOT ANY MORE (owner, 2026-09-19: "on poster i see no
     button to ... confirmed offered"). Their confirmation is a separate stamp
     (`poster_confirmed_at`) that the Helpr setting off does not answer — so
     this line deleted the poster's ONLY confirm-offer control, and its
     "You: Confirmed / Pending" read-back with it, the instant the Helpr tapped
     "I'm on my way", whether or not the poster had ever confirmed. A poster who
     had not confirmed lost the box before they could; one who had lost any
     trace that they did.

     The 24h window below is UNCHANGED and deliberately so: widening when a
     poster may confirm is a policy call, not a rendering fix. */
  if (helperOnTheWayAt && !isOwner) return null;
  // Poster's row, from On My Way: PosterConfirmationPrimary's arrival box is the one primary (owner, 2026-10-08).
  if (variant === "inline" && isOwner && (helperOnTheWayAt || helperArrivedAt)) return null;

  const isLiveJob = jobStatus === "accepted" || jobStatus === "in_progress";
  /* THE WINDOW CLOSES WHEN THE JOB DAY DOES — for the helper.
     `hoursUntilJob` is measured from MIDNIGHT of the job date, so the old -12
     floor closed this card at NOON on the day of the job. For an evening
     booking that is hours before the helper sets off, and it left a hole in the
     gate the tracker now depends on: HelperTrackerPanel holds "I'm on my way"
     until the day-of confirmation lands, and it can only do that while there is
     a control here to land it with. Past -12 the card vanished, the gate had to
     stand down rather than dead-end the helper, and an unconfirmed helper on an
     8 PM job could set off at 1 PM exactly as before.
     -24 is "any time on the job day", which is the window this card always
     described in words.
     THE POSTER'S runs to the job's START (owner, 2026-10-08, Q1566: "there is
     no place for me to confirm the job is still on"): the old -12 closed it at
     NOON on the job day, so a same-day 2 PM job had no "I'm still on" after
     12:00. No start time: the end of the job day. */
  const posterWindowEnd = posterConfirmClosesMs(dateNeeded, startTime);
  const showConfirmation =
    isLiveJob && confirmOpen && (isOwner ? now.getTime() < posterWindowEnd : hoursUntilJob > -24);

  /* NOT-YET-OPEN IS A STATE, NOT AN ABSENCE.
     This component used to `return null` for every accepted job more than 24
     hours out — while JobTracking, right above it, printed "Confirm the job
     below to unlock the next step". So a helpr who accepted a job three weeks
     ahead was told to do something with nothing underneath to do it with, and
     no way to find out when there would be (owner: "they need ... a way to
     cofnrim 24 hours that they will be there ... actually look at what youre
     doing and make sure its good work bc its not rn", and "they need a
     coundown for the time to confirm they will be at the job").

     Same card, same two status chips, no button — plus the clock the helpr was
     missing. The window opens at midnight the day before (confirmOpensMs); a
     malformed date_needed (never on prod: NOT NULL DATE) renders nothing. */
  if (Number.isNaN(opensMs)) return null;
  if (isLiveJob && !confirmOpen) {
    /* The Helpr's primary BEFORE the window opens is this step, greyed (owner,
       2026-10-08: "they must confirm 24 hours before they can mark on their
       way, so that button should be confirm you will be at the job, not on my
       way"). */
    const opensAtForNote = new Date(opensMs);
    /* THE POSTER'S CARD NEVER SHOWS A DISABLED FUTURE STEP (owner, 2026-10-21: "the primary button must be
       the action that stage actually needs"). Before the window it says when it opens; the step's own
       primary ("Message Yusef") takes the slot. */
    if (variant === "inline" && isOwner) {
      return (
        <JobStepRowSlot slot="note">
          <p className="font-sans text-ds-10" data-poster-confirm-wait-note="" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            You and {otherFirstName || "your Helpr"} confirm the day before. Opens{" "}
            {opensAtForNote.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}.
          </p>
        </JobStepRowSlot>
      );
    }
    /* THE HELPR'S CARD NEVER SHOWS A GREYED CONFIRM EITHER (lead ruling 2026-10-21): the step's own primary
       ("Message Lexi") holds the slot; the tracker line says the moment it opens ("Confirm the day before.
       Opens Wed 12:00 AM") and the card's clock counts down to it, so nothing is added here. */
    if (hideNotYetOpen) return null;
    // The shared helper, not midnight minus 24h: that is 23:00 or 01:00 on the two DST days.
    const opensAt = new Date(opensMs);
    const minsUntilOpen = Math.max(0, Math.round((opensAt.getTime() - now.getTime()) / 60_000));
    const d = Math.floor(minsUntilOpen / 1440);
    const h = Math.floor((minsUntilOpen % 1440) / 60);
    const m = minsUntilOpen % 60;
    const untilOpen = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    // The window AND the deadline, quoted together: a confirm is owed until 2 hours
    // before the start, then the job is reposted (owner, 2026-10-08).
    const confirmBy = new Date(deadlineMs);
    /* A STRIP, not a card: the date is already on the card twice; what was
       missing is one clock and one sentence. */
    return (
      <>
        <div
          className="flex items-start gap-2 p-2 rounded-ds-sm border"
          style={{
            background: "hsl(var(--amber-tint) / 0.05)",
            borderColor: "hsl(var(--amber-tint) / 0.20)",
            color: "hsl(var(--muted-foreground))",
          }}
        >
          <CalendarClock className="w-4 h-4 shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <p className="text-ds-11 font-semibold tabular-nums">
              Confirmation opens in {untilOpen}
            </p>
            <p className="text-ds-10 mt-0.5">
              The day before, we ask you both to confirm you're still on — that's
              what unlocks the rest of the tracker.
            </p>
            {!isOwner && (
              <p className="text-ds-10 mt-0.5 font-semibold tabular-nums">
                Confirm by{" "}
                {confirmBy.toLocaleString("en-US", {
                  timeZone: JOB_TIMEZONE,
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {" "}({CONFIRM_DEADLINE_HOURS_BEFORE_START} hours before it starts), or it's reposted to other Helprs.
              </p>
            )}
          </div>
        </div>
      </>

    );
  }

  if (!showConfirmation) return null;

  const handleConfirm = async () => {
    setConfirming(true);
    // The helper's day-before tap writes its OWN stamp. `helper_confirmed_at` was set the moment they accepted (maybe
    // days ago), so re-writing it here made this card a no-op for helpers and the "we ask you both" copy a
    // poster-only promise — the 2026-08-24 lifecycle review's first finding.
    const field = isOwner ? "poster_confirmed_at" : "helper_dayof_confirmed_at";
    // Cast: Supabase generated types reject computed-key updates because the index signature widens to `[x: string]:
    // never`. Runtime accepts any valid column name; the `field` variable is constrained above to one of two known
    // column names.
    //
    // .select("id") + unwrapMutation, NOT a bare `const { error }`: this is the ONE write behind the step the card
    // itself calls "what unlocks the rest of the tracker", and an UPDATE that matches zero rows (RLS, a job cancelled
    // out from under the card, a stale id) returns `{ data: [], error: null }`. Without the row count this sailed
    // down the success path — it set the local "confirmed ✓" state AND notified the other party that a confirmation
    // had happened, while `poster_confirmed_at` / `helper_dayof_confirmed_at` stayed null and the tracker never
    // advanced past Accepted. Both sides then believed a step had completed that had not. (CLAUDE.md: "a null error
    // does NOT mean the write happened".)
    let confirmFailed = false;
    const confirmedAt = new Date().toISOString();
    try {
      unwrapMutation(
        await supabase
          .from("jobs")
          .update({ [field]: confirmedAt } as never)
          .eq("id", jobId)
          .select("id"),
        {
          action: "confirm the job",
          rejectedMessage:
            "We couldn't record that confirmation — this job may have been cancelled. Pull to refresh.",
          context: { jobId, field },
        },
      );
    } catch (err) {
      if (!isWriteRejected(err)) {
        report(err, { tags: { source: "JobConfirmation.handleConfirm" } });
      }
      confirmFailed = true;
      hapticError();
      toast.error(mutationErrorMessage(err, "We couldn't confirm just now — please try again."));
    }
    if (!confirmFailed) {
      hapticSuccess();
      setLocalConfirmedAt(confirmedAt);
      // Home's Next up, the nav badge and Jobs > Posted/Working drop the step at once (LEAD-NEEDSYOU-MISSING).
      recordConfirmInActivityCache(jobId, field, confirmedAt);
      onConfirm?.();
      if (!isOwner) void offerIdentityCheckAfterConfirm(); // confirm, THEN Stripe Identity, then On the way
      // Notify the other party
      const { data: job, error: jobFetchErr } = await supabase.from("jobs").select("title, customer_id, helper_id").eq("id", jobId).single();
      if (jobFetchErr) {
        console.error("[JobConfirmation] Failed to fetch job for notification:", jobFetchErr.message);
      }
      if (job) {
        const recipientId = isOwner ? job.helper_id : job.customer_id;
        if (recipientId) {
          const { notifyJobParty } = await import("@/lib/notifications");
          // Server-built copy (Q223); the server picks the poster/Helpr
          // wording and the `?job=` link from which side the caller is on.
          await notifyJobParty({ user_id: recipientId, job_id: jobId, template: "job_confirmed" });
        }
      }
    }
    setConfirming(false);
    setShowConfirmDialog(false);
  };

  // Only the Helpr's own tap counts (Q1570). One shared rule (see helperDayOfConfirmation above), so this card and
  // the tracker panel that gates "I'm on my way" on it cannot disagree.
  const helperDayOf = helperDayOfConfirmation({ helperConfirmedAt, helperDayofConfirmedAt, dateNeeded, startTime });
  const myConfirmed = localConfirmedAt || (isOwner ? posterConfirmedAt : helperDayOf);

  const urgencyText = hoursUntilJob <= 0
    ? "Job date has passed"
    : hoursUntilJob < 24
    ? "less than 24 hours"
    : (() => { const h = Math.round(hoursUntilJob); return `${h} hour${h !== 1 ? "s" : ""}`; })();

  // "Thursday, October 22, 2037 at 9:00 AM": the day being confirmed, and the time when the job has one.
  const scheduledStart = startTime ? jobStartDateTime(dateNeeded, startTime) : null;
  const scheduledFor = `${jobDate.toLocaleDateString("en-US", { timeZone: JOB_TIMEZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" })}${
    scheduledStart ? ` at ${scheduledStart.toLocaleTimeString("en-US", { timeZone: JOB_TIMEZONE, hour: "numeric", minute: "2-digit" })}` : ""
  }`;

  /* The confirm popup, hoisted out of the card's return so BOTH variants
     render the identical flow — the "Scheduled for" date, the no-show warning,
     and the hand-off to the caller's real cancel path. The inline variant drops
     the card's chrome, never its consequences. */
  const confirmDialog = (
    <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
      <DialogContent>
        {/* Plain words by role, no "commit" (owner 2026-10-31, LEAD-CONFIRM-WORDS). */}
        <DialogHero title={isOwner ? "Confirm the job is still on" : "Confirm you'll be there"} />
        <div className="space-y-3">
          {jobTitle?.trim() && (
            <p data-confirm-job-title="" className="text-ds-16 font-semibold text-foreground [overflow-wrap:anywhere]">{jobTitle.trim()}</p>
          )}
          <div
            className="rounded-ds-md p-3"
            style={{
              background: "hsl(var(--ivory-sand) / 0.4)",
              border: "0.5px solid hsl(var(--olivewood) / 0.10)",
            }}
          >
            <p className="text-ds-11 font-sans font-semibold uppercase tracking-[0.06em] text-muted-foreground mb-0.5">
              Scheduled for
            </p>
            <p
              className="font-display font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
            >
              {/* F11 (audit 2026-10-28): the start time with the date, both on Louisiana time. */}
              {scheduledFor}
            </p>
          </div>
          {/* The SHARED consequence box. This was a hand-built copy of it —
              same 8% sienna fill, same sienna hairline, same AlertTriangle —
              one border width and one radius token off from the one
              BrandConfirmDialog renders behind every confirm in the app.
              The words name each side's real consequence (LEAD-CONFIRM-WORDS, owner 10-31): a poster
              who cancels within 24 hours of the start, once the Helpr confirmed, pays 25% of the price
              (50% inside 2 hours) and the sweep sends it to the Helpr (computeCancellationFee,
              void-cancelled-payments); before the Helpr confirms there is no fee. A Helpr keeps the
              no-show line. */}
          <DialogCallout>
            {posterConfirmWarning(isOwner, helperConfirmedAt)}
          </DialogCallout>
        </div>
        <DialogFooter>
          {/* "Not now", not "Cancel" (F11): it sat beside the job-cancel link below, two cancels
              that do very different things. */}
          <DialogSecondaryAction onClick={() => setShowConfirmDialog(false)}>Not now</DialogSecondaryAction>
          <DialogPrimaryAction
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? "Confirming…" : isOwner ? "Yes, it's still on" : "Yes, I'll be there"}
          </DialogPrimaryAction>
        </DialogFooter>
        {/* Distinct from Cancel: Cancel just dismisses this popup, nothing
            changes. This hands off to the caller's real cancel/decline flow
            — a reliability strike for a Helpr backing out, a reopened job
            for a poster — so it can't read as a second, lighter Cancel. */}
        {onCantMakeIt && (
          <button
            type="button"
            onClick={() => { setShowConfirmDialog(false); onCantMakeIt(); }}
            className="w-full text-center text-ds-11 font-sans underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            Cancel job
          </button>
        )}
      </DialogContent>
    </Dialog>
  );

  /* THE DEADLINE, ONCE THE WINDOW IS OPEN. Same source as the sweeps
     (`confirmDeadlineMs`), so the card cannot imply a window longer than the
     one `sweep_confirm_reminders_and_repost` and `auto-expire-jobs` enforce. Helper-only: the poster's confirmation
     gates nothing and nothing expires on it. Rendered above the control in
     BOTH variants — the helper's tracker uses `inline`, which is only the
     button, so a deadline shown solely on the card variant would never reach
     the person it applies to. */
  // THE REPOST AT T-2h (owner, 2026-10-08; sweep_confirm_reminders_and_repost): the day-before confirm is owed until
  // 2 hours before the start, and the line says that moment (`deadlineMs` above). No start time: the job day's
  // midnight, minus 2 h.
  const deadlineNotice = !isOwner && isHelper && !myConfirmed && (
    <p
      className="text-ds-10 font-sans font-semibold tabular-nums mb-1.5"
      style={{ color: "hsl(var(--ink-deep))" }}
    >
      {deadlineMs > now.getTime()
        ? `Confirm by ${new Date(deadlineMs).toLocaleString("en-US", {
            timeZone: JOB_TIMEZONE,
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          })} (${Math.max(1, Math.round((deadlineMs - now.getTime()) / 60_000 / 60))}h left) or it's reposted to other Helprs.`
        : "Confirmation is past due — this job is being reposted to other Helprs."}
    </p>
  );

  /** The one control, shared by both variants so they can't drift.
   *
   *  text-ds-14, not the old text-ds-12: this is a row PRIMARY (it portals
   *  into the step row's primary slot on the inline variant) and every other
   *  primary in the activity cards is 14px — the chips are the 11px tier and
   *  nothing else is in between (owner, 2026-09-19: "the buttons word size and
   *  font need to be consistent"). `h-auto min-h-[44px]` replaces the flat
   *  `h-11` for the same reason JobStepPrimaryButton names it: inside the row
   *  the CSS releases the height so a two-line label fits, so a control that
   *  declares 44px and renders 61px is a size class the cascade defeated —
   *  the buttonGeometry a11y gate reads `h-auto` as "released on purpose".
   *  The 44px tap-target floor is unchanged. */
  // MOVED BY AN ACCEPTED CHANGE (owner, 2026-10-21): both sides confirm the NEW slot, and every line names it.
  const newSlot = rescheduled ? slotLabel(dateNeeded, startTime) : "";
  const confirmCtaClass = "w-full h-auto min-h-[44px] text-ds-14";
  const confirmCta = (isOwner || isHelper) && (
    !myConfirmed ? (
      <Button
        variant="primary"
        size="sm"
        onClick={() => setShowConfirmDialog(true)}
        className={confirmCtaClass}
      >
        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
        {newSlot ? "Confirm" : "I'm still on"}
      </Button>
    ) : null
    /* Poster confirmed: no greyed "Confirm they've arrived" here either (owner, 2026-10-21); the
       note under it says what happens next. */
  );
  // NUDGE (answer 1): while the other side still owes its confirm.
  const otherUnconfirmed = isOwner ? !helperDayOf : isHelper ? !posterConfirmedAt : false;
  const waitingWords = newSlot
    ? `Waiting for ${otherFirstName || "your Helpr"} to confirm ${newSlot}`
    : `Waiting on ${otherFirstName || "your Helpr"} to confirm by ${new Date(deadlineMs).toLocaleString("en-US", { timeZone: JOB_TIMEZONE, weekday: "short", hour: "numeric", minute: "2-digit" })}`;
  const rescheduleNote = newSlot && !myConfirmed && (isOwner || isHelper) ? (
    <p className="font-sans text-ds-10 font-semibold" data-new-time-confirm-note="" style={{ color: "hsl(var(--ink-deep))" }}>
      {isOwner ? `Confirm the new time, ${newSlot}` : `Confirm you'll be there ${newSlot}`}
    </p>
  ) : null;
  const nudgeLine = showConfirmation && otherUnconfirmed && jobStatus === "accepted" ? (
    // The poster's one status line carries the Nudge (owner, 2026-10-21): "Waiting on Yusef to confirm, by Sat 7 AM · Nudge".
    <NudgeConfirmLink jobId={jobId} otherLabel={isOwner ? otherFirstName || "Your Helpr" : "The person who posted it"} lead={isOwner && myConfirmed ? waitingWords : undefined} />
  ) : null;
  // The poster has answered: say what happens next, never a greyed future button (owner, 2026-10-21).
  // While the Helpr still owes theirs, the Nudge line above IS the status line ("Waiting on Yusef … · Nudge").
  const posterNextNote = isOwner && myConfirmed && !nudgeLine ? (
    <p className="font-sans text-center text-ds-10" data-poster-next-step-note="" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      {helperDayOf ? `You're both confirmed. ${otherFirstName || "Your Helpr"} taps On my way when they leave.` : `${waitingWords}.`}
    </p>
  ) : null;

  /* MERGED INTO THE TRACKER — no box, no heading, no date, no chips.
     Everything this variant drops is said by the step rail directly above it:
     "Confirmed" is the step, its colour is whether it's done, and this button
     is how it gets done. */
  if (variant === "inline") {
    /* Inside a job step card the control is that card's primary and renders in
       its ONE action row, the deadline on the line above it (owner,
       2026-09-14, VN-21). Outside one, both slots render in place. */
    /* THE ROW'S OWN CONTROL, not this file's panel CTA (owner, 2026-09-19,
       second report: "the buttons need to have the same size font and
       everything they shouldnt have all different stuff").

       This used to portal `confirmCta` — `confirmCtaClass`, an inline 14px
       button — straight into a row of stacked 11px chips, so "I'm still on"
       was a different object from the Message and Directions beside it. It is
       the easiest drift in the app to miss, because nothing under
       src/components/job-card draws it. It goes through
       `JobStepPrimaryButton` now, exactly like every other primary in that
       slot; the `done` tone carries the owner's other rule (the box stays,
       disabled, once it has been tapped) without a greyed-out green.

       The PANEL variant below still uses `confirmCta` — it is not in a row,
       and holding a standalone card CTA to the row's 11px would be the same
       mistake in the other direction. */
    const rowCta = (isOwner || isHelper) && (
      !myConfirmed ? (
        <JobStepPrimaryButton
          icon={CheckCircle2}
          label={newSlot ? "Confirm" : isHelper ? HELPER_CONFIRM_LABEL : "I'm still on"}
          onClick={() => setShowConfirmDialog(true)}
        />
      ) : null
      /* Poster confirmed: NO greyed "Confirm they've arrived" (owner, 2026-10-21, supersedes the
         2026-10-08 greyed next step). The step's own primary ("Message Yusef") takes the slot and
         the note says what happens next. The arrival box appears from On the way. */
    );
    return (
      <>
        <JobStepRowSlot slot="note">{rescheduleNote}{deadlineNotice}{posterNextNote}{nudgeLine}</JobStepRowSlot>
        <JobStepRowSlot slot="primary">{rowCta}</JobStepRowSlot>
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <div
        className={embedded ? "space-y-1.5" : "rounded-2xl liquid-glass p-3 space-y-1.5"}
        style={
          embedded
            ? undefined
            : {
                background:
                  "radial-gradient(80% 100% at 50% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%)",
              }
        }
      >
        <div>
          <h3
            className="font-display font-bold leading-tight text-ds-14"
            style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.015em" }}
          >
            Still on for this one?
          </h3>
        </div>
        <p
          className="font-sans leading-snug text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          Tap to let the other party know it's a go.
          {hoursUntilJob > 0 && ` Scheduled in ${urgencyText}.`}
        </p>
        <p
          className="font-sans text-ds-11"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {jobDate.toLocaleDateString("en-US", { timeZone: JOB_TIMEZONE, weekday: "long", month: "short", day: "numeric" })}
          {hoursUntilJob > 0 && ` · ${urgencyText} away`}
        </p>

        {/* No You/Helpr Confirmed chips or receipt (owner, 2026-10-08). */}
        {rescheduleNote}
        {deadlineNotice}
        {confirmCta}
        {posterNextNote}
        {nudgeLine}
      </div>

      {confirmDialog}
    </>
  );
}
