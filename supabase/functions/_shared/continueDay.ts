/**
 * COULDN'T FINISH: CONTINUE ANOTHER DAY (owner 2026-11-01, Yusef's job; migration 20261101231015).
 *
 * While a job has an ACTIVE continue day (public.job_continue_days, status 'proposed' or 'set'), the work is not
 * done, so the approval clock does not run: auto-release-payment neither escalates the job to Helpr support nor
 * releases it on the poster's instant-release opt-in. The money is untouched; the release just waits. A poster's
 * own approval still releases (their approval closes the continue day, trigger close_continue_day_on_job_change).
 *
 * FAIL CLOSED: a read error is `ok: false`, and the caller holds every candidate. A missing table (42P01 /
 * PGRST205, the deploy window before the migration) holds no job: a database without the table has no continue day.
 *
 * One import, caughtMessage (itself import-free); the caller passes its service-role client, so the edge test harness
 * runs the REAL module.
 * Guard: src/test/edge/continueDayHold.test.ts.
 */
import { caughtMessage } from "./caughtMessage.ts";

/** The statuses that hold a job: a day proposed by the Helpr and not answered, or a day the poster set. */
const CONTINUE_DAY_ACTIVE_STATUSES = ["proposed", "set"] as const;

const tableMissing = (error: unknown) => {
  const code = String((error as { code?: string } | null)?.code ?? "");
  return code === "42P01" || code === "PGRST205";
};

/** Which of `jobIds` have an active continue day. Fails closed. */
export async function loadContinuingJobs(
  db: { from: (t: string) => any },
  jobIds: ReadonlyArray<string | null | undefined>,
): Promise<{ ok: true; jobs: Set<string> } | { ok: false; message: string }> {
  const ids = [...new Set(jobIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const jobs = new Set<string>();
  if (ids.length === 0) return { ok: true, jobs };
  let res: { data: Array<{ job_id: string; status: string }> | null; error: { message?: string; code?: string } | null };
  try {
    res = await db
      .from("job_continue_days")
      .select("job_id, status")
      .in("job_id", ids)
      .in("status", [...CONTINUE_DAY_ACTIVE_STATUSES]);
  } catch (err) {
    return { ok: false, message: caughtMessage(err) };
  }
  if (res.error) {
    if (tableMissing(res.error)) return { ok: true, jobs };
    return { ok: false, message: res.error.message ?? "continue day read failed" };
  }
  for (const row of res.data ?? []) {
    if (row && ids.includes(row.job_id) && (CONTINUE_DAY_ACTIVE_STATUSES as readonly string[]).includes(row.status)) jobs.add(row.job_id);
  }
  return { ok: true, jobs };
}

/** Is this job held by a continue day? An unread check holds it (fail closed). */
export function heldByContinueDay(
  read: { ok: true; jobs: Set<string> } | { ok: false; message: string },
  jobId: string,
): boolean {
  return !read.ok || read.jobs.has(jobId);
}
