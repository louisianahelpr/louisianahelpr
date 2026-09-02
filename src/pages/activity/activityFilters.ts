import { useMemo } from "react";
import { isPastDue } from "@/lib/jobDate";
import type { Job, AppliedApp } from "@/components/activity/activityConstants";

/**
 * activityFilters — status-filter definitions and the memoized list/count
 * derivations for the Activity page.
 *
 * The filter keys are no longer job_status enum values, so they no longer
 * borrow `jobStatusLabel` / `jobStatusColorClasses`: the four are derived
 * buckets about WHOSE MOVE IT IS (see ActivityBucket below), and a bucket that
 * spans several statuses has no single enum colour to paint itself with. The
 * legacy enum keys still work as filter VALUES for deep links — they just have
 * no chip of their own any more.
 */

export interface StatusFilter {
  key: string;
  label: string;
  color: string;
}

// Neutral palette for broad-bucket filters (All, Active).
const ALL_FILTER_COLOR = "bg-[hsl(var(--olivewood)/0.08)] text-[hsl(var(--olivewood))] border-[hsl(var(--olivewood)/0.18)]";

// Granular sub-status filters (Open, Accepted, In Progress, etc.) are
// intentionally omitted — those statuses are surfaced as colored banners
// on each job card, so the filter sheet stays at the high-level bucket level.
/**
 * WHOSE MOVE IS IT — the four buckets both Activity tabs filter by.
 *
 * They replace Active / All / Completed / Cancelled, which sorted by the job's
 * own lifecycle rather than by anything the reader can act on. That is why a
 * job whose work was finished and was sitting on the poster's approval still
 * appeared under "Active" (owner: "if this is completed it doesn't belong in
 * the active section") — "active" is true of it, and useless. It is also why
 * the per-card status band had to exist at all: one bucket held open jobs,
 * offered jobs, in-progress jobs and jobs awaiting a decision, so every card
 * needed a label to say which. Sorting by whose move it is answers that in the
 * tab, which is what let the band come off.
 *
 * NEEDS YOU  — a decision is sitting with the reader RIGHT NOW. This is also
 *              where a PAST-DUE job lands, whatever its status — see
 *              {@link jobIsOverdue}.
 * WAITING    — the ball is in someone else's court; nothing to do but wait.
 * SCHEDULED  — agreed and UPCOMING, or underway today. Never a day that has
 *              already been and gone.
 * DONE       — finished successfully. Terminal.
 * CANCELLED  — cancelled, or (applied side) not selected. Terminal, but kept
 *              separate from DONE (product direction, 2026-08-30 — a
 *              cancelled job did not "finish", so folding it into the same
 *              tab as a completed one buried the distinction the reader
 *              actually cares about: did this job happen or not).
 *
 * Every job lands in exactly one, and the five are exhaustive — which is what
 * makes dropping the old catch-all "All" safe. There is no state that falls
 * through them.
 */
export type ActivityBucket = "needs_you" | "waiting" | "scheduled" | "done" | "cancelled";

const BUCKET_LABEL: Record<ActivityBucket, string> = {
  needs_you: "Needs You",
  waiting: "Waiting",
  scheduled: "Scheduled",
  done: "Done",
  cancelled: "Cancelled",
};

/**
 * ORDER: Needs you · Scheduled · Waiting · Done · Cancelled (owner).
 *
 * Not the lifecycle order — it runs by how much of the reader's attention each
 * one deserves. What is being asked of you comes first, what you have committed
 * to second, what you can do nothing about third, what is over fourth, and
 * what never happened last — it deserves the least attention of all five.
 */
const BUCKET_FILTERS: StatusFilter[] = (
  ["needs_you", "scheduled", "waiting", "done", "cancelled"] as ActivityBucket[]
).map((key) => ({ key, label: BUCKET_LABEL[key], color: ALL_FILTER_COLOR }));

export const POSTED_STATUS_FILTERS: StatusFilter[] = BUCKET_FILTERS;
export const APPLIED_STATUS_FILTERS: StatusFilter[] = BUCKET_FILTERS;

/**
 * Which bucket a job I POSTED belongs in.
 *
 * `applicantCount` is what separates an open job with people waiting on a
 * reply (my move) from one nobody has answered yet (nothing to do). Without it
 * every open job would read as "waiting", which is the opposite of true for the
 * ones with a queue.
 */
/**
 * Is there a submission sitting on the poster's approval RIGHT NOW?
 *
 * `helper_completed_at` is NOT cleared when the poster sends work back for a
 * revision — it is kept deliberately, as a record of what happened (see the
 * note in JobTracking.tsx, which makes the same allowance in the progress
 * tracker). So the raw stamp answers "has this helpr ever submitted", not "is
 * a submission waiting on me".
 *
 * Reading it as the latter is what made a job stick in "Needs you" forever
 * after a revision round-trip: the poster asks for changes, the helpr goes
 * back to work, the job returns to in_progress — and the stale stamp still
 * out-ranked the `in_progress → scheduled` line below it. Any later write that
 * arrived without the field flipped the card to Scheduled and the next one
 * flipped it back, which is the bucket "jumping" the owner reported.
 *
 * A submission counts only if it is NEWER than the last revision request.
 * Unparseable timestamps compare false and fall through to the old behaviour
 * (treat as outstanding), which is the safe side: it asks for a look rather
 * than hiding work.
 */
/**
 * Is this job's day gone with the job still unresolved?
 *
 * "Scheduled" is a promise about the FUTURE. A job dated 27 August, still
 * `in_progress` on the 31st, is not scheduled — it is the single thing on the
 * screen most needing someone to act, and filing it under Scheduled is the app
 * telling the reader it is fine. Twelve prod jobs were sitting exactly there
 * (owner, 2026-08-31: "These jobs were posted for Aug 27 still marked under
 * scheduled?").
 *
 * Deliberately NOT its own sixth bucket. The five are "whose move is it", and
 * an overdue job's answer is the same as every other Needs You row: yours.
 * A sixth chip would also split a poster's attention across two tabs on the one
 * day they can least afford it, and would not fit the chip row at 320px.
 *
 * DAY granularity, not minute: a job dated today is never overdue, however late
 * in the day it is read. `jobs.date_needed` is a bare `date` and the day is the
 * only promise the poster made; flipping a card to "Needs you" at 9:05am
 * because a 9:00 start had not been stamped yet would cry wolf on every job.
 * `isPastDue` resolves both midnights in the PLATFORM's zone (America/Chicago),
 * which is what stops a reader in another timezone seeing a different verdict —
 * see the note in `@/lib/jobDate`.
 *
 * Terminal states are checked BEFORE this in both bucketers: a job that
 * completed or was cancelled has nothing left to chase, whatever its date.
 */
function jobIsOverdue(j: { status?: string | null; date_needed?: string | null }): boolean {
  if (j.status === "completed" || j.status === "cancelled") return false;
  return isPastDue(j.date_needed);
}


function submissionAwaitingPoster(j: {
  helper_completed_at?: string | null;
  poster_completed_at?: string | null;
  revision_requested_at?: string | null;
}): boolean {
  if (!j.helper_completed_at || j.poster_completed_at) return false;
  if (!j.revision_requested_at) return true;
  const submitted = Date.parse(j.helper_completed_at);
  const sentBack = Date.parse(j.revision_requested_at);
  if (Number.isNaN(submitted) || Number.isNaN(sentBack)) return true;
  return submitted > sentBack;
}

export function postedActivityBucket(
  j: {
    status: string;
    helper_id?: string | null;
    helper_confirmed_at?: string | null;
    helper_completed_at?: string | null;
    poster_completed_at?: string | null;
    revision_requested_at?: string | null;
    direct_offer_status?: string | null;
    date_needed?: string | null;
  },
  /** Applications still AWAITING a decision — not every application ever filed. */
  pendingApplicantCount = 0,
): ActivityBucket {
  if (j.status === "cancelled") return "cancelled";
  if (j.status === "completed") return "done";
  // Work submitted and not yet approved, a revision I asked for, or an open
  // dispute — all three are a decision sitting with me.
  if (j.status === "revision_requested" || j.status === "disputed") return "needs_you";
  if (submissionAwaitingPoster(j)) return "needs_you";
  // The day came and went and the job never resolved. Whatever the status
  // underneath — nobody applied, nobody confirmed, nobody finished — the next
  // move is the poster's: chase the helpr, close it out, or re-post it. See
  // jobIsOverdue for why this is not a bucket of its own.
  if (jobIsOverdue(j)) return "needs_you";
  if (j.status === "in_progress") return "scheduled";
  if (j.status === "accepted") {
    // Booked and confirmed is scheduled; booked and unconfirmed is me waiting
    // on the helpr to say yes.
    return j.helper_confirmed_at ? "scheduled" : "waiting";
  }
  if (j.status === "open") {
    return pendingApplicantCount > 0 ? "needs_you" : "waiting";
  }
  return "waiting";
}

/** Which bucket a job I APPLIED to belongs in. */
export function appliedActivityBucket(app: AppliedApp): ActivityBucket {
  const jobStatus = app.job?.status;
  if (app.status === "rejected" || jobStatus === "cancelled") return "cancelled";
  if (jobStatus === "completed") return "done";
  // An offer held for me, or a revision the poster asked for — my move, and the
  // offer is the one that expires if I do nothing.
  if (needsHelperResponse(app)) return "needs_you";
  if (jobStatus === "revision_requested") return "needs_you";
  // An open dispute carries a required action for the helper (Respond to
  // Dispute) — their move, not a quiet scheduled state.
  if (jobStatus === "disputed") return "needs_you";
  if (jobStatus === "in_progress") {
    // Work submitted, sitting on the poster's approval — waiting on the
    // other party by definition, not "scheduled". Stays WAITING even when the
    // day has passed: the helpr has done everything asked of them, and moving
    // it to "Needs you" would ask them for a second thing they cannot give.
    if (app.job?.helper_completed_at && !app.job?.poster_completed_at) return "waiting";
    // Underway, day gone, nothing submitted — the helpr's move. Mirrors the
    // poster side so the same job never reads "Scheduled" to one party and
    // overdue to the other.
    if (jobIsOverdue({ status: jobStatus, date_needed: app.job?.date_needed })) return "needs_you";
    return "scheduled";
  }
  if (app.status === "accepted") {
    // A booking whose day has passed and which never even started.
    if (jobIsOverdue({ status: jobStatus, date_needed: app.job?.date_needed })) return "needs_you";
    return "scheduled";
  }
  // Applied, awaiting their decision.
  return "waiting";
}

/**
 * Section bucket — used by the grouped "All" view to fold every status
 * into Active / Completed / Cancelled. Each list/card on the screen
 * goes through one of these three buckets exactly once.
 */
export type Bucket = "active" | "completed" | "cancelled";

/** Classify a posted job into Active / Completed / Cancelled. */
export function bucketPostedJob(job: { status: string }): Bucket {
  switch (job.status) {
    case "completed": return "completed";
    case "cancelled":
    case "disputed":  return "cancelled";
    default:          return "active"; // open / accepted / in_progress / revision_requested / direct_offer holders
  }
}

/**
 * Is this card waiting on the helper right now?
 *
 * Two states qualify, and they are the two where the job is being HELD for
 * this helper and lapses if they do nothing:
 *   - a pending direct offer from a poster, and
 *   - an accepted application the helper has not yet confirmed.
 *
 * `helper_confirmed_at` is the discriminator for the second: an application
 * can read `accepted` while the helper still has to say yes.
 */
function needsHelperResponse(app: {
  status: string;
  job?: { status?: string; direct_offer_status?: string | null; helper_confirmed_at?: string | null } | null;
}): boolean {
  if (app.job?.direct_offer_status === "pending") return true;
  return (
    app.status === "accepted" &&
    (app.job?.status === "accepted" || app.job?.status === "open") &&
    !app.job?.helper_confirmed_at
  );
}

export function bucketAppliedApp(app: { status: string; job?: { status: string } | null }): Bucket {
  const jobStatus = app.job?.status;
  if (jobStatus === "completed") return "completed";
  if (jobStatus === "cancelled") return "cancelled";
  if (app.status === "rejected") return "cancelled";
  return "active";
}

export interface UseActivityFiltersArgs {
  postedJobs: Job[];
  appliedApps: AppliedApp[];
  statusFilter: string;
  searchQuery: string;
  userId: string | undefined;
  /** Applications STILL AWAITING A DECISION, per posted job id — decides
   *  whether an OPEN job is waiting for applicants or waiting on the poster to
   *  read the ones it has. Deliberately not the total: a job whose every
   *  applicant was declined is not asking the poster for anything. */
  pendingApplicantCounts?: Record<string, number>;
}

export function useActivityFilters({
  postedJobs,
  appliedApps,
  statusFilter,
  searchQuery,
  userId,
  pendingApplicantCounts,
}: UseActivityFiltersArgs) {
  const searchLower = searchQuery.toLowerCase().trim();

  const filteredPostedJobs = useMemo(() =>
    postedJobs.filter((j) => {
      // Status filter — "all" disables the status gate; the page renders
      // groups instead. Search still applies in both modes.
      let statusMatch: boolean;
      // The five buckets come first. The legacy keys below them are NOT dead:
      // notification deep links still arrive as `?filter=completed` and the
      // like, and a link that lands on an empty list because its key stopped
      // being understood is worse than a tab set with more keys than chips.
      if (
        statusFilter === "needs_you" ||
        statusFilter === "waiting" ||
        statusFilter === "scheduled" ||
        statusFilter === "done" ||
        statusFilter === "cancelled"
      ) {
        statusMatch =
          postedActivityBucket(j, pendingApplicantCounts?.[j.id] ?? 0) === statusFilter;
      }
      else if (statusFilter === "all") statusMatch = true;
      else if (statusFilter === "active") statusMatch = bucketPostedJob(j) === "active";
      else if (statusFilter === "direct_offer") statusMatch = !!j.offered_to_helper_id && j.direct_offer_status === "pending";
      else if (statusFilter === "offered") statusMatch = j.status === "accepted" && !j.helper_confirmed_at;
      else if (statusFilter === "accepted") statusMatch = j.status === "accepted" && !!j.helper_confirmed_at;
      else statusMatch = j.status === statusFilter && !(statusFilter === "open" && j.direct_offer_status === "pending");
      if (!statusMatch) return false;
      // Search filter
      if (searchLower) {
        // `location` is null once the poster deletes their account and the job
        // is anonymised (20260901033011). This runs inside a filter callback,
        // so an unguarded null here throws and takes out the WHOLE list, not
        // one row — the same shape as the unparseable date that once emptied
        // /my-posts. A job with no address simply never matches a text search,
        // which is the truthful answer rather than a swallowed one.
        return j.title.toLowerCase().includes(searchLower) || j.description.toLowerCase().includes(searchLower) || (j.location?.toLowerCase().includes(searchLower) ?? false);
      }
      return true;
    })
      // Overdue floats to the top — the one visual treatment an overdue job
      // gets from this layer.
      //
      // A STABLE partition, not a re-sort (same shape as the applied-side lift
      // below): within each group the incoming order is untouched, so this only
      // ever pulls the jobs whose day has already gone past the ones still to
      // come. Needs You can hold both a fresh application and a job that is
      // four days late, and the late one is not something to scroll for.
      .sort((a, b) => Number(jobIsOverdue(b)) - Number(jobIsOverdue(a))),
    [postedJobs, statusFilter, searchLower, pendingApplicantCounts]);

  const filteredAppliedApps = useMemo(() => {
    const query = searchLower;
    return appliedApps.filter((a) => {
      let statusMatch = false;
      if (
        statusFilter === "needs_you" ||
        statusFilter === "waiting" ||
        statusFilter === "scheduled" ||
        statusFilter === "done" ||
        statusFilter === "cancelled"
      ) {
        statusMatch = appliedActivityBucket(a) === statusFilter;
      }
      else if (statusFilter === "all") statusMatch = bucketAppliedApp(a) !== "cancelled";
      else if (statusFilter === "active") statusMatch = bucketAppliedApp(a) === "active";
      else if (statusFilter === "direct_offer") statusMatch = !!a.job?.offered_to_helper_id && a.job?.offered_to_helper_id === userId && a.job?.direct_offer_status === "pending";
      else if (statusFilter === "pending") statusMatch = a.status === "pending" && a.job?.status !== "cancelled";
      else if (statusFilter === "offered") statusMatch = a.status === "accepted" && a.job?.status === "accepted" && !a.job?.helper_confirmed_at;
      else if (statusFilter === "accepted") statusMatch = a.status === "accepted" && a.job?.status === "accepted" && !!a.job?.helper_confirmed_at;
      else if (statusFilter === "in_progress") statusMatch = a.status === "accepted" && a.job?.status === "in_progress";
      else if (statusFilter === "disputed") statusMatch = a.status === "accepted" && a.job?.status === "disputed";
      else if (statusFilter === "revision") statusMatch = a.status === "accepted" && a.job?.status === "revision_requested";
      else if (statusFilter === "completed") statusMatch = a.status === "accepted" && a.job?.status === "completed";
      else if (statusFilter === "not_selected") statusMatch = a.status === "rejected" || a.job?.status === "cancelled";
      if (!statusMatch) return false;
      if (query && a.job) {
        // Same null-location guard as the search predicate above, same reason:
        // this is a filter callback, so a throw here empties the applications
        // list instead of dropping one card.
        return a.job.title.toLowerCase().includes(query) || a.job.description.toLowerCase().includes(query) || (a.job.location?.toLowerCase().includes(query) ?? false);
      }
      return true;
    })
      // Anything waiting on the HELPER floats to the top of the list.
      //
      // Owner: "Offered to you should always be shown first — I don't want them
      // to miss an offer." A direct offer and an unconfirmed booking are the
      // only two states where a job is being held for this helper and will be
      // given away if they do nothing. Everything else — applications out for
      // review, work already booked, jobs in progress — can wait its turn,
      // because nothing expires while the helper reads it.
      //
      // A STABLE partition, not a re-sort: within each group the existing
      // order is preserved untouched, so this only ever lifts the time-critical
      // cards past the ones that aren't.
      //
      // Overdue is the tie-break, never the lead: an offer expires if it is
      // missed, a late job does not get any later for being read second.
      .sort((a, b) =>
        Number(needsHelperResponse(b)) - Number(needsHelperResponse(a)) ||
        Number(jobIsOverdue({ status: b.job?.status, date_needed: b.job?.date_needed })) -
          Number(jobIsOverdue({ status: a.job?.status, date_needed: a.job?.date_needed })));
    // Dep list intentionally matches the pre-refactor Activity.tsx exactly
    // (userId omitted) to preserve identical memo behavior — userId comes
    // from a stable session and the page only renders past `loading`.
  }, [appliedApps, statusFilter, searchLower]);

  const appliedCounts = useMemo(() => {
    const counts: Record<string, number> = { all: 0, active: 0, pending: 0, direct_offer: 0, offered: 0, accepted: 0, in_progress: 0, revision: 0, completed: 0, disputed: 0, not_selected: 0, needs_you: 0, waiting: 0, scheduled: 0, done: 0, cancelled: 0 };
    appliedApps.forEach((a) => {
      const bucket = bucketAppliedApp(a);
      // The four tab counts. Tallied on their own line, never inside the
      // `else if` chain below — an app belongs to exactly one bucket AND to one
      // legacy status, and folding them together would let whichever branch
      // matched first swallow the row from the other tally.
      counts[appliedActivityBucket(a)]++;
      // "all" excludes not-selected (rejected / cancelled) — mirrors filteredAppliedApps.
      if (bucket !== "cancelled") counts.all++;
      // Counted separately from the chain below, not inside it: "active" is a
      // BUCKET that overlaps several of the single-status counters, so it must
      // not consume an `else if` branch and steal rows from them.
      if (bucket === "active") counts.active++;
      if (a.job?.offered_to_helper_id === userId && a.job?.direct_offer_status === "pending") counts.direct_offer++;
      if (a.status === "pending" && a.job?.status !== "cancelled") counts.pending++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !a.job?.helper_confirmed_at) counts.offered++;
      else if (a.status === "accepted" && a.job?.status === "accepted" && !!a.job?.helper_confirmed_at) counts.accepted++;
      else if (a.status === "accepted" && a.job?.status === "in_progress") counts.in_progress++;
      else if (a.status === "accepted" && a.job?.status === "disputed") counts.disputed++;
      else if (a.status === "accepted" && a.job?.status === "revision_requested") counts.revision++;
      else if (a.status === "accepted" && a.job?.status === "completed") counts.completed++;
      else if (a.status === "rejected" || a.job?.status === "cancelled") counts.not_selected++;
    });
    return counts;
  }, [appliedApps]);

  const postedCounts = useMemo(() => {
    const counts: Record<string, number> = { all: postedJobs.length, active: 0, open: 0, direct_offer: 0, offered: 0, accepted: 0, in_progress: 0, revision_requested: 0, completed: 0, cancelled: 0, disputed: 0, needs_you: 0, waiting: 0, scheduled: 0, done: 0 };
    postedJobs.forEach((j) => {
      // See the note in appliedCounts — bucket tallies stay out of the chain.
      counts[postedActivityBucket(j, pendingApplicantCounts?.[j.id] ?? 0)]++;
      if (bucketPostedJob(j) === "active") counts.active++;
      if (j.offered_to_helper_id && j.direct_offer_status === "pending") counts.direct_offer++;
      if (j.status === "accepted" && !j.helper_confirmed_at) counts.offered++;
      else if (j.status === "accepted" && !!j.helper_confirmed_at) counts.accepted++;
      // `j.status === "cancelled"` is skipped here — the bucket tally above
      // already counted it under the SAME "cancelled" key (the new
      // ActivityBucket literally shares its name with the legacy status
      // string), so falling through to this generic per-status tally too
      // would double-count every cancelled job.
      else if (j.status !== "cancelled") counts[j.status] = (counts[j.status] || 0) + 1;
    });
    return counts;
  }, [postedJobs, pendingApplicantCounts]);

  return { filteredPostedJobs, filteredAppliedApps, appliedCounts, postedCounts };
}
