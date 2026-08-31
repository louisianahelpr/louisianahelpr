import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHero, DialogFooter } from "@/components/ui/dialog";
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck, CalendarClock } from "lucide-react";
import { parseLocalDate } from "@/lib/dateUtils";
import { toast } from "sonner";
import { hapticError, hapticSuccess } from "@/lib/haptics";
import { unwrapMutation, mutationErrorMessage, isWriteRejected } from "@/lib/mutationResult";
import { report } from "@/lib/errorLogger";

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
export function helperDayOfConfirmation({
  helperConfirmedAt,
  helperDayofConfirmedAt,
  dateNeeded,
}: {
  helperConfirmedAt: string | null;
  helperDayofConfirmedAt?: string | null;
  dateNeeded: string;
}): string | null {
  if (helperDayofConfirmedAt) return helperDayofConfirmedAt;
  if (!helperConfirmedAt) return null;
  const jobDate = parseLocalDate(dateNeeded);
  return jobDate.getTime() - new Date(helperConfirmedAt).getTime() <= 24 * 3_600_000
    ? helperConfirmedAt
    : null;
}

export function JobConfirmation({
  jobId,
  isOwner,
  isHelper,
  posterConfirmedAt,
  helperConfirmedAt,
  helperDayofConfirmedAt = null,
  dateNeeded,
  jobStatus,
  helperOnTheWayAt,
  onConfirm,
  onCantMakeIt,
  variant = "card",
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
  jobStatus?: string;
  helperOnTheWayAt?: string | null;
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

  const jobDate = parseLocalDate(dateNeeded);
  const now = new Date();
  const hoursUntilJob = (jobDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  // Hide once helper is on the way or beyond
  if (helperOnTheWayAt) return null;

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
     described in words. The POSTER keeps the original -12: their confirmation
     gates nothing, and their card is unchanged. */
  const showConfirmation =
    isLiveJob && hoursUntilJob <= 24 && hoursUntilJob > (isOwner ? -12 : -24);

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
    const opensAt = new Date(jobDate.getTime() - 24 * 3_600_000);
    const minsUntilOpen = Math.max(0, Math.round((opensAt.getTime() - now.getTime()) / 60_000));
    const d = Math.floor(minsUntilOpen / 1440);
    const h = Math.floor((minsUntilOpen % 1440) / 60);
    const m = minsUntilOpen % 60;
    const untilOpen = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
    /* A STRIP, not a card. The first draft of this state was a full
       liquid-glass card with its own heading and paragraph, which put a THIRD
       card on a scheduled job — "Job starts in 5d 3h", the tracker, and then a
       card repeating the same date a third time to say nothing had happened
       yet. The date is already on the card twice; what was actually missing is
       one clock and one sentence, so that is all this is. */
    return (
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
        </div>
      </div>
    );
  }

  if (!showConfirmation) return null;

  const handleConfirm = async () => {
    setConfirming(true);
    // The helper's day-before tap writes its OWN stamp. `helper_confirmed_at`
    // was set the moment they accepted (maybe days ago), so re-writing it here
    // made this card a no-op for helpers and the "we ask you both" copy a
    // poster-only promise — the 2026-08-24 lifecycle review's first finding.
    const field = isOwner ? "poster_confirmed_at" : "helper_dayof_confirmed_at";
    // Cast: Supabase generated types reject computed-key updates because the
    // index signature widens to `[x: string]: never`. Runtime accepts any
    // valid column name; the `field` variable is constrained above to one of
    // two known column names.
    //
    // .select("id") + unwrapMutation, NOT a bare `const { error }`: this is the
    // ONE write behind the step the card itself calls "what unlocks the rest of
    // the tracker", and an UPDATE that matches zero rows (RLS, a job cancelled
    // out from under the card, a stale id) returns `{ data: [], error: null }`.
    // Without the row count this sailed down the success path — it set the
    // local "confirmed ✓" state AND notified the other party that a
    // confirmation had happened, while `poster_confirmed_at` /
    // `helper_dayof_confirmed_at` stayed null and the tracker never advanced
    // past Accepted. Both sides then believed a step had completed that had
    // not. (CLAUDE.md: "a null error does NOT mean the write happened".)
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
          const { createNotification } = await import("@/lib/notifications");
          await createNotification({
            user_id: recipientId,
            title: isOwner ? "Poster confirmed the job!" : "Helpr confirmed the job!",
            message: `${isOwner ? "The poster" : "The Helpr"} confirmed they're committed to "${job.title}". Tap to confirm your side too.`,
            type: "info",
            link: isOwner ? `/my-jobs?filter=offered` : `/my-posts?filter=offered`,
          });
        }
      }
    }
    setConfirming(false);
    setShowConfirmDialog(false);
  };

  // A helper accept that itself happened inside the 24h window IS a
  // day-before answer — don't ask the same question twice. One shared rule
  // (see helperDayOfConfirmation above), so this card and the tracker panel
  // that gates "I'm On My Way" on it cannot disagree.
  const helperDayOf = helperDayOfConfirmation({ helperConfirmedAt, helperDayofConfirmedAt, dateNeeded });
  const myConfirmed = localConfirmedAt || (isOwner ? posterConfirmedAt : helperDayOf);
  const otherConfirmed = isOwner ? helperDayOf : posterConfirmedAt;
  const otherLabel = isOwner ? "Helpr" : "Poster";

  const urgencyText = hoursUntilJob <= 0
    ? "Job date has passed"
    : hoursUntilJob < 24
    ? "less than 24 hours"
    : `${Math.round(hoursUntilJob)} hours`;

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
          <div
            className="rounded-ds-md p-3"
            style={{
              background: "hsl(var(--burnt-sienna) / 0.08)",
              border: "0.5px solid hsl(var(--burnt-sienna) / 0.22)",
            }}
          >
            <p
              className="font-serif italic leading-snug flex items-start gap-2 text-ds-12"
              style={{ color: "hsl(var(--burnt-sienna))" }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>No-shows or last-minute cancellations after confirming may result in a warning or account restrictions.</span>
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setShowConfirmDialog(false)} className="rounded-ds-md">Cancel</Button>
          <Button
            variant="primary"
            onClick={handleConfirm}
            disabled={confirming}
            className="rounded-ds-md"
          >
            {confirming ? "Confirming…" : "Yes, I Confirm"}
          </Button>
        </DialogFooter>
        {/* Distinct from Cancel: Cancel just dismisses this popup, nothing
            changes. This hands off to the caller's real cancel/decline flow
            — a reliability strike for a Helpr backing out, a reopened job
            for a poster — so it can't read as a second, lighter Cancel. */}
        {onCantMakeIt && (
          <button
            type="button"
            onClick={() => { setShowConfirmDialog(false); onCantMakeIt(); }}
            className="w-full text-center text-ds-11 font-serif italic underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
          >
            Can't make it? See what happens
          </button>
        )}
      </DialogContent>
    </Dialog>
  );

  /** The one control, shared by both variants so they can't drift. */
  const confirmCta = !myConfirmed && (isOwner || isHelper) && (
    <Button
      variant="primary"
      size="sm"
      onClick={() => setShowConfirmDialog(true)}
      // h-11, not the old h-8: at 32px this was the smallest interactive
      // control on either job card and ~12px under the WCAG 2.5.5 / project
      // 44px floor that every sibling button already meets.
      className="w-full rounded-ds-md h-11 min-h-[44px] text-ds-12"
    >
      <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
      I'm Still On
    </Button>
  );

  /* MERGED INTO THE TRACKER — no box, no heading, no date, no chips.
     Everything this variant drops is said by the step rail directly above it:
     "Confirmed" is the step, its colour is whether it's done, and this button
     is how it gets done. */
  if (variant === "inline") {
    return (
      <>
        {confirmCta}
        {confirmDialog}
      </>
    );
  }

  return (
    <>
      <div
        className="rounded-2xl liquid-glass p-3 space-y-1.5"
        style={{
          background:
            "radial-gradient(80% 100% at 50% 0%, hsl(var(--burnt-sienna) / 0.08) 0%, transparent 60%)",
        }}
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
          className="font-serif italic leading-snug text-ds-12"
          style={{ color: "hsl(var(--olivewood) / 0.85)" }}
        >
          Tap to let the other party know it's a go.
          {hoursUntilJob > 0 && ` Scheduled in ${urgencyText}.`}
        </p>
        <p
          className="font-serif italic text-ds-11"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {jobDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
          {hoursUntilJob > 0 && ` · ${urgencyText} away`}
        </p>

        <div className="flex items-center gap-1.5">
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold"
            style={
              myConfirmed
                ? { background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))", border: "0.5px solid hsl(var(--bark) / 0.22)" }
                : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.8)" }
            }
          >
            {myConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            You: {myConfirmed ? "Confirmed" : "Pending"}
          </span>
          <span
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold"
            style={
              otherConfirmed
                ? { background: "hsl(var(--bark) / 0.10)", color: "hsl(var(--bark))", border: "0.5px solid hsl(var(--bark) / 0.22)" }
                : { background: "hsl(var(--olivewood) / 0.08)", color: "hsl(var(--olivewood) / 0.8)" }
            }
          >
            {otherConfirmed ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
            {otherLabel}: {otherConfirmed ? "Confirmed" : "Pending"}
          </span>
        </div>

        {myConfirmed && (
          <p className="font-serif italic inline-flex items-center gap-1 text-ds-10" style={{ color: "hsl(var(--bark) / 0.85)" }}>
            <ShieldCheck className="w-3 h-3" />
            Confirmed {new Date(myConfirmed).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </p>
        )}

        {confirmCta}
      </div>

      {confirmDialog}
    </>
  );
}
