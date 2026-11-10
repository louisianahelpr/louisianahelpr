/**
 * A3-45 (audit 11-01): the Applicants sheet says what the poster does next and by when. It showed only "<job> · Sun,
 * Nov 1" on a job starting in 30 minutes. Now, under that line: "Next: choose a Helpr · by Sat, Nov 16, 9:00 AM"
 * (the start, or the listing's close if that is first: listingDeadline, the same instant the browse card and the
 * "New application" notice name), and what happens if nobody is hired: auto-expire-jobs closes the open job at
 * expires_at ("the scheduled time passed with no Helpr hired"), and a card hold (payment_status 'held') is released.
 * Guard: src/pages/posts/postedJobs/applicantsPanel/ApplicantsNextStep.test.tsx.
 */
import { NextStep, type NextStepValue } from "@/components/ui/NextStep";
import { listingDeadline } from "@/lib/listingDeadline";

type PickJob = {
  status?: string | null;
  payment_status?: string | null;
  expires_at?: string | null;
  date_needed?: string | null;
  start_time?: string | null;
};

const TZ = "America/Chicago";
const dayWords = (d: Date) => d.toLocaleDateString("en-US", { timeZone: TZ, weekday: "short", month: "short", day: "numeric" });
const timeWords = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" });

/** The step, its deadline and the consequence; null when the job is not open or nobody is waiting. */
export function applicantsNextStep(job: PickJob, pending: number, now: Date = new Date()): { step: NextStepValue; ifNot: string | null } | null {
  if (job.status !== "open" || pending <= 0) return null;
  const first = listingDeadline(job);
  const closeMs = job.expires_at ? Date.parse(job.expires_at) : NaN;
  let by: string | null = null;
  let byAt: Date | null = null;
  if (first && first.at.getTime() > now.getTime()) {
    byAt = first.at;
    // A start with no time counts to the end of its day: name the day only.
    by = first.startsFirst && !job.start_time ? `by ${dayWords(first.at)}` : `by ${dayWords(first.at)}, ${timeWords(first.at)}`;
  } else if (Number.isFinite(closeMs) && closeMs > now.getTime()) {
    byAt = new Date(closeMs);
    by = `by ${dayWords(byAt)}, ${timeWords(byAt)}`;
  }
  let ifNot: string | null = null;
  if (Number.isFinite(closeMs) && closeMs > now.getTime()) {
    const close = new Date(closeMs);
    const card = job.payment_status === "held" ? " and your card isn't charged" : "";
    // Audit 11-10 W2 F289: the sheet named two cut-offs on one day ("by Sun, Nov 15, 10:00 AM" over "If nobody is
    // hired by Sun, Nov 15, 12:28 PM, the job closes"), so the poster could not tell which was real. When the close
    // falls on the pick-by's Louisiana day (or is the pick-by itself) the second line refers back to the first; a close
    // days later (a listing open past its start) still names its own day and time.
    ifNot = byAt && dayWords(byAt) === dayWords(close)
      ? `If nobody is hired by then, the job closes${card}.`
      : `If nobody is hired by ${dayWords(close)}, ${timeWords(close)}, the job closes${card}.`;
  }
  return { step: { who: "you", text: "Choose a Helpr", by }, ifNot };
}

export function ApplicantsNextStep({ job, pending }: { job: PickJob; pending: number }) {
  const v = applicantsNextStep(job, pending);
  if (!v) return null;
  return (
    <div className="-mt-1 mb-3" data-applicants-next-step="">
      <NextStep value={v.step} />
      {v.ifNot && <p className="text-ds-13 text-muted-foreground">{v.ifNot}</p>}
    </div>
  );
}
