import type { AppliedApp, Job } from "@/components/job-card/activityConstants";
import { postedActivityBucket, appliedActivityBucket, jobIsOverdue, jobIsUnfundedDraft } from "@/components/job-card/activityFilters";
import { posterStatusLine, helperStatusLine } from "@/components/job-card/jobStatusLine";
import { jobProgress, type JobProgressState } from "@/components/tracker/jobProgressState";

/**
 * The two Home states around Next up (boards 83 and 165, spec v2 §5.1 + §9.22 +
 * §9.33), from the same activity rows Home already reads. Nothing invented:
 * every word is the job card's own status sentence or a real column.
 */


export interface LiveNow {
  id: string;
  jobId: string;
  title: string;
  /** Which side you are on ("You hired" / "You're working"). */
  side: string;
  /** The job card's own sentence for this moment ("Finish and mark it done", "Your Helpr is working"). */
  detail: string;
  /** When the Helpr arrived, if the row says so: the card's "Started 2:04 PM". */
  startedAt: string | null;
  /** THE one tracker's state for this job (owner, 2026-10-21), from the same rules as every card. */
  progress: JobProgressState;
}

/**
 * LIVE NOW (board 165): a job of mine, either side, that is HAPPENING: status
 * in_progress and its day not yet passed (an in_progress row from last week
 * is an overdue job, which Next up already asks about, not a live one).
 * The most recently started one wins; only one card is ever shown.
 */
/** The hired Helpr's name for a posted job, when the activity read has it (useActivityData.helperNames, by user id). */
function hiredName(j: Job, helperNames: Readonly<Record<string, string>>): string | null {
  return (j.helper_id && helperNames[j.helper_id]) || null;
}
const firstOf = (n: string | null) => (n ? n.trim().split(/\s+/)[0] || null : null);

/** JA-38 (audit 11-01): the poster's lines name their Helpr ("Yusef is on the way"), as the job page and card do. */
export function deriveLiveNow(postedJobs: readonly Job[], appliedApps: readonly AppliedApp[], helperNames: Readonly<Record<string, string>> = {}): LiveNow | null {
  const live = (j: Job | null | undefined): j is Job => !!j && j.status === "in_progress" && !jobIsOverdue(j);
  const started = (j: Job) => j.helper_arrived_at ?? j.helper_on_the_way_at ?? j.updated_at ?? "";
  const candidates: LiveNow[] = [
    ...postedJobs.filter(live).map((j) => ({
      id: `lp-${j.id}`,
      jobId: j.id,
      title: j.title,
      side: "You hired",
      detail: posterStatusLine(j, 0, new Date(), undefined, false, hiredName(j, helperNames)).detail,
      startedAt: j.helper_arrived_at ?? null,
      progress: jobProgress(j, { viewer: "poster", otherFirst: firstOf(hiredName(j, helperNames)) }),
      sort: started(j),
    })),
    ...appliedApps
      .filter((a) => live(a.job) && a.job!.helper_id === a.helper_id)
      .map((a) => ({
        id: `la-${a.id}`,
        jobId: a.job!.id,
        title: a.job!.title,
        side: "You're working",
        detail: helperStatusLine(a).detail,
        startedAt: a.job!.helper_arrived_at ?? null,
        progress: jobProgress(a.job!, { viewer: "helpr", otherFirst: (a.posterName ?? "").split(" ")[0] || null }),
        sort: started(a.job!),
      })),
  ].sort((x, y) => (y.sort > x.sort ? 1 : y.sort < x.sort ? -1 : 0));
  if (!candidates.length) return null;
  const c = candidates[0];
  return { id: c.id, jobId: c.jobId, title: c.title, side: c.side, detail: c.detail, startedAt: c.startedAt, progress: c.progress };
}

export interface Waiting {
  id: string;
  jobId: string;
  /** "Waiting on Travis" / "Waiting on your Helpr" / "Waiting on Helprs". */
  label: string;
  title: string;
  detail: string;
}

/**
 * WAITING (board 83): when nothing is the member's to do, Next up is never
 * blank: it says who is up. The first job of mine, either side, whose card
 * files it under Waiting; the line is that card's own sentence.
 */
export function deriveWaiting(
  postedJobs: readonly Job[],
  pendingApplicantCounts: Readonly<Record<string, number>>,
  appliedApps: readonly AppliedApp[],
  /**
   * The job Live now already shows (lead 10-31): a Helpr at work is Waiting, and Live now says so above Next up,
   * so Next up names the next one instead of repeating it ("Your Helpr is working" twice).
   */
  liveJobId: string | null = null,
  helperNames: Readonly<Record<string, string>> = {},
): Waiting | null {
  const firstName = (n?: string | null) => (n ? n.trim().split(/\s+/)[0] : null);
  for (const a of appliedApps) {
    if (!a.job || a.job.id === liveJobId || appliedActivityBucket(a) !== "waiting") continue;
    const who = firstName(a.posterName);
    return {
      id: `wa-${a.id}`,
      jobId: a.job.id,
      label: who ? `Waiting on ${who}` : "Waiting on a reply",
      title: `You applied · ${a.job.title}`,
      detail: helperStatusLine(a).detail,
    };
  }
  for (const j of postedJobs) {
    if (jobIsUnfundedDraft(j)) continue;
    const n = pendingApplicantCounts[j.id] ?? 0;
    if (j.id === liveJobId || postedActivityBucket(j, n) !== "waiting") continue;
    return {
      id: `wp-${j.id}`,
      jobId: j.id,
      label: j.helper_id ? `Waiting on ${firstOf(hiredName(j, helperNames)) ?? "your Helpr"}` : "Waiting on Helprs",
      title: j.title,
      detail: posterStatusLine(j, n, new Date(), undefined, false, hiredName(j, helperNames)).detail,
    };
  }
  return null;
}
