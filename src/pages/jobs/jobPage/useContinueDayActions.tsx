import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { userFacingError } from "@/lib/userFacingError";
import { ContinueDaySheet } from "@/components/jobs/ContinueDaySheet";
import { MissedReturnSheet } from "@/components/jobs/MissedReturnSheet";
import { MISSED_LABEL_HELPR, MISSED_LABEL_POSTER, continueDayMissedOpen, fetchOpenMissedReturn } from "@/lib/continueDayMissed";
import { CONTINUE_DAY_LABEL, answerContinueDay, continueDayAnswer, confirmContinueDay, continueDayAhead, continueDayDoneNote, continueDayLabel, continueDayNextStep, fetchContinueDay, type ContinueDay } from "@/lib/continueDay";
import type { NextStepValue } from "@/components/ui/NextStep";
import type { RowAction } from "./JobPageActionRow";
import type { PagePrimary } from "./posterPageActions";
import { helperProgress } from "@/pages/jobs/appliedJobCard/steps/helperProgress";
import type { Job } from "@/components/job-card/activityConstants";

/**
 * The job page's half of "Couldn't finish: continue another day" (owner 2026-11-01, Yusef's job; src/lib/continueDay.ts):
 *  - the poster: "Not finished? Set a day" (set at once), and on a Helpr's ask the one-tap "Confirm new day" leads the
 *    row (over Approve: the work is not done), with Decline beside it;
 *  - the hired Helpr: "Not finished? Set a day" too (one name, Q2593; sent to the poster to confirm), and once a day is set "Confirm I'll be there";
 *  - both: the next-step line "Continuing Thu 11/5 at 9 AM · waiting on Yusef".
 * Only on a solo job under way, only for its two people (the server checks it all again).
 */
export function useContinueDayActions({
  job,
  side,
  otherFirst,
  trackingStatus = null,
  onChanged,
}: {
  job: { id: string; status: string | null; has_active_dispute?: boolean | null; is_group_job?: boolean | null; helper_completed_at?: string | null; helper_arrived_at?: string | null; helper_arrival_verified_at?: string | null; poster_confirmed_arrival_at?: string | null } | null | undefined;
  /** Who is looking: the poster, the hired Helpr, or nobody on the job (null: nothing shown). */
  side: "poster" | "helpr" | null;
  otherFirst: string | null;
  /** The job's latest job_tracking.status: with the stamps, whether day 1's work has started (helperProgress). */
  trackingStatus?: string | null;
  onChanged: () => void;
}): {
  row: ContinueDay | null;
  step: NextStepValue | null;
  posterLead: PagePrimary | undefined;
  posterExtras: RowAction[];
  helprLead: RowAction | null;
  helprExtras: RowAction[];
  /** "Not finished? Set a day" (both sides): a visible text button under the row (null: none). */
  setDay: RowAction | null;
  sheet: React.ReactNode;
  /** Owner #4 (11-08): the "Didn't come back" / "Can't come back" sheet (null: none). */
  missedSheet: React.ReactNode;
  /**
   * A SET day still ahead (Auditor 11, 11-01): the server refuses "done" until then (continue_day_ahead), so the
   * Helpr's row never leads with "Mark job complete", and the poster's row drops the card's on-site actions (SOS):
   * nobody is at the job.
   */
  doneAhead: boolean;
  /** "You can mark it done on Thu 11/5, the day you set to finish." while doneAhead (the Helpr's side). */
  doneAheadNote: string | null;
} {
  // Once the Helpr is there (arrived, by any of the three stamps): before that, a new day is "Change date or time".
  const arrived = !!job && !!(job.helper_arrived_at || job.helper_arrival_verified_at || job.poster_confirmed_arrival_at);
  // Q2593 (Jobs audit 1102b row 7): never while a dispute is open (Louisiana Helpr is deciding the job as it stands).
  const live = !!job && !!side && job.status === "in_progress" && !job.has_active_dispute && !job.is_group_job && arrived;
  const q = useQuery({
    queryKey: ["job-continue-day", job?.id ?? ""],
    queryFn: () => fetchContinueDay(job!.id),
    enabled: live,
    staleTime: 30_000,
  });
  // Owner #4 (11-08): an open "Didn't come back" / "Can't come back" report (Louisiana Helpr is reviewing the job).
  const missedQ = useQuery({
    queryKey: ["job-missed-return", job?.id ?? ""],
    queryFn: () => fetchOpenMissedReturn(job!.id),
    enabled: live,
    staleTime: 30_000,
  });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [missedOpen, setMissedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Work started on day 1 (the Working card's own rule): before that, there is no "another day" to ask for (B118
  // follow-up, lead 11-01). An active continue day keeps its "different day" button whatever the stamps say.
  const workStarted = !!job && helperProgress(job as unknown as Job, trackingStatus).workUnderway;
  const none = { row: null, step: null, posterLead: undefined, posterExtras: [], helprLead: null, helprExtras: [], setDay: null, sheet: null, missedSheet: null, doneAhead: false, doneAheadNote: null };
  if (!live || !job || !side) return none;

  const row = q.data ?? null;
  const refresh = () => { void q.refetch(); void missedQ.refetch(); onChanged(); };
  if (missedQ.data) {
    // Sent to Louisiana Helpr: no new day (the server refuses continue_day_missed_open), nothing else to tap.
    return { ...none, step: { who: "info", text: "Sent to Louisiana Helpr", by: "reviewing the job and the payment" } };
  }
  const run = (fn: () => Promise<void>, done: string) => async () => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      refresh();
    } catch (err) {
      toast.error(userFacingError(err, "Couldn't save that. Check your connection and try again."));
    } finally {
      setBusy(false);
    }
  };
  const when = row ? continueDayLabel(row.new_date, row.new_start_time) : "";
  const open = () => setSheetOpen(true);

  let posterLead: PagePrimary | undefined;
  const posterExtras: RowAction[] = [];
  let helprLead: RowAction | null = null;
  const helprExtras: RowAction[] = [];
  let setDay: RowAction | null = null;
  const offerSetDay = workStarted || !!row;
  // The one rule for who answers a proposed day (continueDayAnswer): the job page and both job cards read it.
  const answer = continueDayAnswer(row, side);
  if (side === "poster") {
    // Q2606 (owner): the poster answers only the Helpr's ask; their own ask waits on the Helpr.
    if (row && answer) {
      posterLead = { label: answer.accept, go: () => void run(() => answerContinueDay(row.id, true), answer.accepted)(), disabled: busy };
      posterExtras.push({ key: "continue-decline", label: answer.decline, go: () => void run(() => answerContinueDay(row.id, false), answer.declined)(), disabled: busy });
    }
    if (row?.status === "set") {
      // Auditor 11 (11-01): the pair once a day is set is [Change day | Message], never "SOS | Message".
      posterExtras.push({ key: "continue-change", label: "Change day", go: open });
    } else if (offerSetDay) {
      // A VISIBLE text button under the row, never in More options (lead 11-01: on the Approve stage this is Yusef's case).
      setDay = { key: "continue-set", label: row ? "Set a different day" : CONTINUE_DAY_LABEL, go: open };
    }
  } else {
    // Q2606 (owner): the poster's new day is the Helpr's to accept or decline (answer_job_continue_day, 20261102102402).
    if (row && answer) {
      helprLead = { key: "continue-accept", label: answer.accept, go: () => void run(() => answerContinueDay(row.id, true), answer.accepted)(), disabled: busy };
      helprExtras.push({ key: "continue-decline", label: answer.decline, go: () => void run(() => answerContinueDay(row.id, false), answer.declined)(), disabled: busy });
    }
    if (row?.status === "set" && !row.helper_confirmed_at) {
      helprLead = { key: "continue-confirm", label: "Confirm I'll be there", go: () => void run(() => confirmContinueDay(row.id), `Confirmed for ${when}.`)(), disabled: busy };
    }
    // Q2593: one name on both sides, the owner's "Not finished? Set a day" (it was "Need another day" here).
    // Q2678 (audit 1102e row 14): never once the Helpr marked it done; one tap would clear their own Done (they can Message).
    if (offerSetDay && !job.helper_completed_at) setDay = { key: "continue-ask", label: row ? "Ask for a different day" : CONTINUE_DAY_LABEL, go: open };
  }

  // Owner #4 (11-08): the agreed day passed (start + 6 h) without "Mark done": the poster's "Didn't come back", the
  // Helpr's "Can't come back". In the row's extras, so they sit in More options beside Change day / Message.
  if (continueDayMissedOpen(row, job.helper_completed_at)) {
    const extras = side === "poster" ? posterExtras : helprExtras;
    extras.push({ key: "continue-missed", label: side === "poster" ? MISSED_LABEL_POSTER : MISSED_LABEL_HELPR, go: () => setMissedOpen(true) });
  }

  // Q2679 (audit 1102e row 16): the sheet carries the name of the button that opened it.
  // No day yet: undefined, the sheet's own "Set a day to finish".
  const sheetTitle = !row
    ? undefined
    : side === "helpr"
      ? "Ask for a different day"
      : row.status === "set" ? "Change day" : "Set a different day";
  const doneAhead = continueDayAhead(row);
  return {
    row,
    doneAhead,
    doneAheadNote: side === "helpr" ? continueDayDoneNote(row) : null,
    step: continueDayNextStep(row, { side, otherFirst }),
    posterLead,
    posterExtras,
    helprLead,
    helprExtras,
    setDay,
    sheet: (
      <ContinueDaySheet open={sheetOpen} onOpenChange={setSheetOpen} jobId={job.id} side={side} otherFirst={otherFirst} onSaved={refresh} helprMarkedDone={!!job.helper_completed_at} title={sheetTitle} />
    ),
    missedSheet: <MissedReturnSheet open={missedOpen} onOpenChange={setMissedOpen} jobId={job.id} side={side} otherFirst={otherFirst} onSent={refresh} />,
  };
}
