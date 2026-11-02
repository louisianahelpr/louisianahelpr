/**
 * The continue-day READS (one job, or several for Home and the to-do list), apart from continueDay.ts: its three
 * calls explain refusals with lifecycleErrors.ts (about 30 KB gz), and Home reads these through useContinueDays on
 * every signed-in first screen (critical-path budget, Q178). continueDay.ts re-exports both, so callers are unchanged.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
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
