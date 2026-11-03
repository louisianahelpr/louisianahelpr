/**
 * The continue-day READS (one job, or several for Home and the to-do list), apart from continueDay.ts: its three
 * calls explain refusals with lifecycleErrors.ts (about 30 KB gz), and Home reads these through useContinueDays on
 * every signed-in first screen (critical-path budget, Q178). continueDay.ts re-exports both, so callers are unchanged.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { report } from "@/lib/errorLogger";
import type { ContinueDay } from "./continueDayWords";

/** The row's columns plus its job's poster, so the row says who asked (Q2606: the other side answers). */
const CONTINUE_DAY_COLUMNS = "id, job_id, proposed_by, new_date, new_start_time, note, status, helper_confirmed_at, job:jobs(customer_id)";

type ContinueDayRead = Omit<ContinueDay, "proposer"> & { job?: { customer_id: string | null } | null };

/** Q2606: the poster asked when proposed_by is the job's poster; otherwise (the Helpr, or a gone account) the Helpr. */
export function withProposer(r: ContinueDayRead): ContinueDay {
  const { job, ...row } = r;
  return { ...row, proposer: row.proposed_by && job?.customer_id && row.proposed_by === job.customer_id ? "poster" : "helpr" };
}

/** The job's active continue day, or null. */
export async function fetchContinueDay(jobId: string): Promise<ContinueDay | null> {
  const rows = unwrap(
    await supabase
      .from("job_continue_days")
      .select(CONTINUE_DAY_COLUMNS)
      .eq("job_id", jobId)
      .in("status", ["proposed", "set"])
      .limit(1),
  ) as ContinueDayRead[] | null;
  return rows?.[0] ? withProposer(rows[0]) : null;
}

/**
 * The active continue days of several jobs, by job id (Home, the to-do list): one read, the same columns and
 * party-only policy as fetchContinueDay.
 */
export async function fetchContinueDays(jobIds: readonly string[]): Promise<Record<string, ContinueDay>> {
  if (!jobIds.length) return {};
  const rows = unwrap(
    await supabase
      .from("job_continue_days")
      .select(CONTINUE_DAY_COLUMNS)
      .in("job_id", [...jobIds])
      .in("status", ["proposed", "set"]),
  ) as ContinueDayRead[] | null;
  return Object.fromEntries((rows ?? []).map((r) => [r.job_id, withProposer(r)]));
}

/** The open SET day of one job: what jobOnContinueDay needs to date the job by its next visit. */
export type OpenContinueDay = Pick<ContinueDay, "job_id" | "status" | "new_date" | "new_start_time">;

/** One read serves both Activity cores (Posted and Working ask together, like get_my_activity_cores). */
let openDaysRead: { userId: string; p: Promise<Record<string, OpenContinueDay>>; served: Set<string>; doneAt: number | null } | null = null;

/** Forget the shared read (the admin previews, previewParts.ts forgetSharedReads; tests). */
export function forgetMyOpenContinueDaysRead(): void {
  openDaysRead = null;
}

/**
 * Owner bug 11-03: the OPEN set continue days (status 'set', closed_at null) of the jobs I posted or am the Helpr on,
 * by job id, so Activity dates a continuing job by its next day and never calls it "Late". No id list (RLS scopes it),
 * so it rides Activity's FIRST wave beside the cores; the two cores share one read (a part asking again
 * is a refetch and reads afresh; an answer is shared for 2 s, ACTIVITY_CORES_SHARE_MS). Never throws: a refused or
 * dropped read is reported and gives {} (the first date stands, as before).
 */
export function fetchMyOpenContinueDays(userId: string, part: "posted" | "applied"): Promise<Record<string, OpenContinueDay>> {
  const r = openDaysRead;
  if (r?.userId === userId && !r.served.has(part) && (r.doneAt === null || Date.now() - r.doneAt <= 2_000)) {
    r.served.add(part);
    return r.p;
  }
  const p = (async () => {
    try {
      const rows = unwrap(
        await supabase
          .from("job_continue_days")
          // No id list and no join: the party policy scopes it to my jobs (poster or Helpr). An admin also reads
          // other open days (20261103212624); only rows matching one of my cards' ids are ever used.
          .select("job_id, status, new_date, new_start_time")
          .eq("status", "set")
          .is("closed_at", null),
      ) as OpenContinueDay[] | null;
      return Object.fromEntries((rows ?? []).map((r) => [r.job_id, r]));
    } catch (e) {
      report(e, { severity: "warning", tags: { source: "continueDayReads.fetchMyOpenContinueDays" } });
      return {};
    }
  })();
  const entry = { userId, p, served: new Set<string>([part]), doneAt: null as number | null };
  openDaysRead = entry;
  void p.then(() => { entry.doneAt = Date.now(); });
  return p;
}
