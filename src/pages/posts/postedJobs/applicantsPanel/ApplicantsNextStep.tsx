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
  if (first && first.at.getTime() > now.getTime()) {
    // A start with no time counts to the end of its day: name the day only.
    by = first.startsFirst && !job.start_time ? `by ${dayWords(first.at)}` : `by ${dayWords(first.at)}, ${timeWords(first.at)}`;
  } else if (Number.isFinite(closeMs) && closeMs > now.getTime()) {
    by = `by ${dayWords(new Date(closeMs))}, ${timeWords(new Date(closeMs))}`;
  }
  let ifNot: string | null = null;
  if (Number.isFinite(closeMs) && closeMs > now.getTime()) {
    const close = new Date(closeMs);
    ifNot = `If nobody is hired by ${dayWords(close)}, ${timeWords(close)}, the job closes${job.payment_status === "held" ? " and your card isn't charged" : ""}.`;
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
