import { useEffect, useState } from "react";
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
import { CheckCircle2, CalendarClock, MapPin } from "lucide-react";
import { confirmOpensMs, jobDayStart } from "@/lib/jobDate";
import { jobStartDateTime } from "@/lib/dateUtils";
import { JOB_TIMEZONE } from "../../supabase/functions/_shared/cancellationFee";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { unwrapMutation, mutationErrorMessage, isWriteRejected } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";
import { JobStepRowSlot } from "@/components/job-card/jobStepRow";
// The row's own done-state surface, so the poster's "already confirmed" box
// matches the Tipped / Reviewed boxes rather than inventing a fourth grey.
import { JobStepPrimaryButton } from "@/components/job-card/JobActionRow";

/**
 * THE HELPER'S DAY-OF ANSWER, in one place.
 *
 * `helper_confirmed_at` is stamped at ACCEPT time — possibly days early — so it
 * cannot answer "are you still on today?". `helper_dayof_confirmed_at`
 * (migration 20260824213000) is the day-before tap. An accept that itself
 * happened inside the 24h window IS a day-of answer, so it counts.
 *
 * Exported because the merged tracker panel on the helper's card
 * (appliedJobCard/HelperTrackerPanel) gates "I'm On My Way" on exactly this
 * value, and a second hand-rolled copy of the rule is how the card and the card
 * it sits inside end up disagreeing about whether the helper has confirmed.
 *
 * Returns the effective STAMP (so callers can print it), or null.
 */

/** The Helpr's day-before step, on its button (owner, 2026-10-08). */
const HELPER_CONFIRM_LABEL = "Confirm You'll Be at the Job";

export function helperDayOfConfirmation({
  helperDayofConfirmedAt,
}: {
  helperConfirmedAt: string | null;
  helperDayofConfirmedAt?: string | null;
  dateNeeded: string;
  /** The job's start. The window is the 24 hours before the START, the same
   *  instant the tracker's Confirmed step measures from (JobTracking
   *  deriveCurrentStatusIdx). This used midnight of the job's day, so an
   *  accept 24h37m before a 2 PM start read "Helpr: Confirmed" here while the
   *  tracker left Confirmed unchecked (owner, 2026-10-08, job 5b68bccb). */
  startTime?: string | null;
}): string | null {
  // ACCEPTING NEVER COUNTS (owner, 2026-10-08, Q1570: "both must tap
  // confirm"): an accept inside the window used to stand in for this tap, so
  // a same-day job reached On My Way with nobody confirming anything.
  return helperDayofConfirmedAt ?? null;
}

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
  /** The Helpr's "I've Arrived" stamp. On the poster's row it hands the
   *  primary to the arrival confirm (PosterConfirmationPrimary). */
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
}) {
  const [confirming, setConfirming] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [localConfirmedAt, setLocalConfirmedAt] = useState<string | null>(null);
  // A minute tick, so the "opens in" clock below actually counts. Without it
  // the card renders once when the list mounts and then sits on a stale number
  // for as long as the screen is open.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);
  void tick;

  const jobDate = jobDayStart(dateNeeded);
  const now = new Date();
  const hoursUntilJob = (jobDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  /* THE HELPER'S card hides once they are on the way or beyond: they have
     answered "still on?" with their feet, and the tracker below takes over.
     Unchanged.

     THE POSTER'S DOES NOT ANY MORE (owner, 2026-09-19: "on poster i see no
     button to ... confirmed offered"). Their confirmation is a separate stamp
     (`poster_confirmed_at`) that the Helpr setting off does not answer — so
     this line deleted the poster's ONLY confirm-offer control, and its
     "You: Confirmed / Pending" read-back with it, the instant the Helpr tapped
     "I'm On My Way", whether or not the poster had ever confirmed. A poster who
     had not confirmed lost the box before they could; one who had lost any
     trace that they did.

     The 24h window below is UNCHANGED and deliberately so: widening when a
     poster may confirm is a policy call, not a rendering fix. */
  if (helperOnTheWayAt && !isOwner) return null;
  // THE POSTER'S ROW (owner, 2026-10-08: "move I'm still on to the right side of
  // more and under profile"): once the Helpr is on the way, the row's primary is
  // the arrival confirm (PosterConfirmationPrimary, greyed until they arrive),
  // never two ("Should only be the greyed out button at the bottom").
  if (variant === "inline" && isOwner && (helperOnTheWayAt || helperArrivedAt)) return null;

  const isLiveJob = jobStatus === "accepted" || jobStatus === "in_progress";
  /* THE WINDOW CLOSES WHEN THE JOB DAY DOES — for the helper.
     `hoursUntilJob` is measured from MIDNIGHT of the job date, so the old -12
     floor closed this card at NOON on the day of the job. For an evening
     booking that is hours before the helper sets off, and it left a hole in the
     gate the tracker now depends on: HelperTrackerPanel holds "I'm On My Way"
     until the day-of confirmation lands, and it can only do that while there is
     a control here to land it with. Past -12 the card vanished, the gate had to
     stand down rather than dead-end the helper, and an unconfirmed helper on an
     8 PM job could set off at 1 PM exactly as before.
     -24 is "any time on the job day", which is the window this card always
     described in words.
     THE POSTER'S runs to the job's START (owner, 2026-10-08, Q1566: "there is
     no place for me to confirm the job is still on"): the old -12 closed it at
     NOON on the job day, so a same-day 2 PM job had no "I'm Still On" after
     12:00. No start time: the end of the job day. */
  const posterWindowEnd = ((startTime ? jobStartDateTime(dateNeeded, startTime) : null) ?? new Date(jobDate.getTime() + 24 * 3_600_000)).getTime();
  const showConfirmation =
    isLiveJob && hoursUntilJob <= 24 && (isOwner ? now.getTime() < posterWindowEnd : hoursUntilJob > -24);

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
     missing. The 24-hour window itself is unchanged; it just says so now. */
  if (isLiveJob && hoursUntilJob > 24) {
    /* The Helpr's primary BEFORE the window opens is this step, greyed (owner,
       2026-10-08: "they must confirm 24 hours before they can mark on their
       way, so that button should be confirm you will be at the job, not on my
       way"). */
    const opensAtForNote = new Date(confirmOpensMs(dateNeeded));
    const waitingPrimary = variant === "inline" && (isHelper || isOwner) ? (
      <>
        <JobStepRowSlot slot="note">
          <p className="font-sans text-ds-10" data-helper-confirm-wait-note="" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
            This button turns on{" "}
            {opensAtForNote.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" })}
            , the day before the job.
          </p>
        </JobStepRowSlot>
        <JobStepRowSlot slot="primary">
          <JobStepPrimaryButton icon={CheckCircle2} label={isHelper ? HELPER_CONFIRM_LABEL : "I'm Still On"} disabled onClick={() => {}} />
        </JobStepRowSlot>
      </>
    ) : null;
    if (hideNotYetOpen) return waitingPrimary;
    // The shared helper, not midnight minus 24h: that is 23:00 or 01:00 on the
    // two DST days, and the sweep uses the helper.
    const opensAt = new Date(confirmOpensMs(dateNeeded));
    const minsUntilOpen = Math.max(0, Math.round((opensAt.getTime() - now.getTime()) / 60_000));
    const d = Math.floor(minsUntilOpen / 1440);
    const h = Math.floor((minsUntilOpen % 1440) / 60);
    const m = minsUntilOpen % 60;
    const untilOpen = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    /* AND THE NUMBER THAT ACTUALLY BINDS. The strip used to say only when the
       window opens, which reads as "then you'll have a day" — the owner's
       objection: "the confirm window is kind of misleading if they have 24
       hours to confirm it says 24 hours." They do not have 24 hours. The sweep
       re-opens the job 12 hours after the window opens, so the window and the
       deadline are quoted together, from the same shared helper the sweep
       itself calls. */
    // Owed until 2 hours before the start, then reposted (owner, 2026-10-08).
    const confirmBy = new Date((jobStartDateTime(dateNeeded, startTime) ?? jobDate).getTime() - 2 * 3_600_000);
    /* A STRIP, not a card. The first draft of this state was a full
       liquid-glass card with its own heading and paragraph, which put a THIRD
       card on a scheduled job — "Job starts in 5d 3h", the tracker, and then a
       card repeating the same date a third time to say nothing had happened
       yet. The date is already on the card twice; what was actually missing is
       one clock and one sentence, so that is all this is. */
    return (
      <>
        {waitingPrimary}
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
                {" "}(2 hours before it starts), or it's reposted to other Helprs.
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
    try {
      unwrapMutation(
        await supabase
          .from("jobs")
          .update({ [field]: new Date().toISOString() } as never)
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
      setLocalConfirmedAt(new Date().toISOString());
      onConfirm?.();
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
  // the tracker panel that gates "I'm On My Way" on it cannot disagree.
  const helperDayOf = helperDayOfConfirmation({ helperConfirmedAt, helperDayofConfirmedAt, dateNeeded, startTime });
  const myConfirmed = localConfirmedAt || (isOwner ? posterConfirmedAt : helperDayOf);

  const urgencyText = hoursUntilJob <= 0
    ? "Job date has passed"
    : hoursUntilJob < 24
    ? "less than 24 hours"
    : (() => { const h = Math.round(hoursUntilJob); return `${h} hour${h !== 1 ? "s" : ""}`; })();

  /* The commit popup, hoisted out of the card's return so BOTH variants
     render the identical flow — the "Scheduled for" date, the no-show warning,
     and the hand-off to the caller's real cancel path. The inline variant drops
     the card's chrome, never its consequences. */
  const confirmDialog = (
    <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
      <DialogContent>
        <DialogHero title="Commit to This Job?" />
        <div className="space-y-3">
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
              className="font-display italic font-bold leading-tight text-ds-16"
              style={{ color: "hsl(var(--ink-deep))", letterSpacing: "-0.012em" }}
            >
              {jobDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
            </p>
          </div>
          {/* The SHARED consequence box. This was a hand-built copy of it —
              same 8% sienna fill, same sienna hairline, same AlertTriangle —
              one border width and one radius token off from the one
              BrandConfirmDialog renders behind every confirm in the app.
              Copy unchanged. */}
          <DialogCallout>
            No-shows or last-minute cancellations after confirming may result in a warning or account restrictions.
          </DialogCallout>
        </div>
        <DialogFooter>
          <DialogSecondaryAction onClick={() => setShowConfirmDialog(false)}>Cancel</DialogSecondaryAction>
          <DialogPrimaryAction
            onClick={handleConfirm}
            disabled={confirming}
          >
            {confirming ? "Confirming…" : "Yes, I Confirm"}
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
            Cancel Job
          </button>
        )}
      </DialogContent>
    </Dialog>
  );

  /* THE DEADLINE, ONCE THE WINDOW IS OPEN. Same source as the sweep
     (`confirmDeadlineMs`), so the card cannot imply a window longer than the
     one `auto-expire-jobs` enforces. Helper-only: the poster's confirmation
     gates nothing and nothing expires on it. Rendered above the control in
     BOTH variants — the helper's tracker uses `inline`, which is only the
     button, so a deadline shown solely on the card variant would never reach
     the person it applies to. */
  // THE REPOST AT T-2h (owner, 2026-10-08; sweep_confirm_reminders_and_repost): the day-before confirm is owed until
  // 2 hours before the start, and the line says that moment. No start time: the job day's midnight, minus 2 h.
  const startForDeadline = jobStartDateTime(dateNeeded, startTime) ?? jobDate;
  const deadlineMs = startForDeadline.getTime() - 2 * 3_600_000;
  const deadlineNotice = !isOwner && isHelper && !myConfirmed && (
    <p
      className="text-ds-10 font-sans font-semibold tabular-nums mb-1.5"
      style={{ color: "hsl(var(--burnt-sienna))" }}
    >
      {deadlineMs > now.getTime()
        ? `Confirm by ${new Date(deadlineMs).toLocaleString("en-US", {
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
  const confirmCtaClass = "w-full rounded-ds-md h-auto min-h-[44px] text-ds-14";
  const confirmCta = (isOwner || isHelper) && (
    !myConfirmed ? (
      <Button
        variant="primary"
        size="sm"
        onClick={() => setShowConfirmDialog(true)}
        className={confirmCtaClass}
      >
        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
        I'm Still On
      </Button>
    ) : isOwner ? (
      /* THE BOX STAYS, DISABLED (owner, 2026-09-19: "if it was clicked already
         it should still show but with the box disabled"). Before this the CTA
         simply evaporated on confirm, so the poster's own answer was carried
         only by a status pill — and the card read as though it had never asked.
         The `done` tone, not a greyed-out green: a disabled primary at half
         opacity is how "you already did this" ends up looking broken.

         POSTER ONLY. The Helpr's branch of this shared component is untouched:
         their control portals into their step card's single action row, where a
         permanent inert box would occupy the primary slot the tracker's own
         next-step CTA needs. */
      /* After confirming: the poster's NEXT step, greyed until its time (owner,
         2026-10-08); the tracker's arrival step is the live control. */
      <Button
        variant="outline"
        size="sm"
        disabled
        data-poster-next-step="arrival"
        className={confirmCtaClass}
      >
        <MapPin className="w-3.5 h-3.5 mr-1" />
        Confirm They've Arrived
      </Button>
    ) : null
  );
  // NUDGE (answer 1): while the other side still owes its confirm.
  const otherUnconfirmed = isOwner ? !helperDayOf : isHelper ? !posterConfirmedAt : false;
  const nudgeLine = showConfirmation && otherUnconfirmed && jobStatus === "accepted" ? (
    <NudgeConfirmLink jobId={jobId} otherLabel={isOwner ? "Your Helpr" : "The person who posted it"} />
  ) : null;
  const posterNextNote = isOwner && myConfirmed ? (
    <p className="font-sans text-center text-ds-10" data-poster-next-step-note="" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
      This button turns on once your Helpr says they've arrived.
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
       button — straight into a row of stacked 11px chips, so "I'm Still On"
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
          label={isHelper ? HELPER_CONFIRM_LABEL : "I'm Still On"}
          onClick={() => setShowConfirmDialog(true)}
        />
      ) : isOwner ? (
        /* After the poster confirms: their NEXT step, greyed until the Helpr
           says they've arrived (docs/JOB-LIFECYCLE.md step 6), the same box
           the panel variant draws. */
        <JobStepPrimaryButton
          icon={MapPin}
          label="Confirm They've Arrived"
          disabled
          onClick={() => {}}
        />
      ) : null
    );
    return (
      <>
        <JobStepRowSlot slot="note">{deadlineNotice}{posterNextNote}{nudgeLine}</JobStepRowSlot>
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
            className="font-display italic font-bold leading-tight text-ds-14"
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
          {jobDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          {hoursUntilJob > 0 && ` · ${urgencyText} away`}
        </p>

        {/* No You/Helpr Confirmed chips or receipt (owner, 2026-10-08). */}
        {deadlineNotice}
        {confirmCta}
        {posterNextNote}
        {nudgeLine}
      </div>

      {confirmDialog}
    </>
  );
}
