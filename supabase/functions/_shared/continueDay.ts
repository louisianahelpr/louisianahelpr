/**
 * COULDN'T FINISH: CONTINUE ANOTHER DAY (owner 2026-11-01, Yusef's job; migration 20261101231015).
 *
 * While a job has an ACTIVE continue day (public.job_continue_days, status 'proposed' or 'set'), the work is not
 * done, so the approval clock does not run: auto-release-payment neither escalates the job to Helpr support nor
 * releases it on the poster's instant-release opt-in, stalled-completion-reminder does not nudge it, and
 * payment-confirm-reminder does not ask the poster to approve. The money is untouched; the release just waits. A
 * poster's own approval still releases (their approval closes the continue day, trigger close_continue_day_on_job_change).
 *
 * THE HOLD ENDS WITH THE DAY (owner 11-08, audit F1): a row stays 'set' until done, approval or a status change, so
 * Yusef's job (day 11/06 3:15 PM) was held with no nudge to anyone for days. A continue day now holds only until its
 * start + CONTINUE_DAY_HOLD_GRACE_HOURS. After that it is LAPSED: the stalled ladder runs again measured from that day
 * (the caller swaps the day in, lapsedContinueDay), and auto-release may escalate it to Helpr support. One thing
 * stays held after the day: an INSTANT release on a lapsed day that was only proposed (nobody agreed the work moved,
 * and the Helpr's earlier done is still on), heldForInstantRelease; a person decides that one.
 *
 * FAIL CLOSED: a read error is `ok: false`, and the caller holds every candidate. A missing table (42P01 /
 * PGRST205, the deploy window before the migration) holds no job: a database without the table has no continue day.
 * A row without a readable day holds its job.
 *
 * Imports: caughtMessage (itself import-free) and jobLocalStartMs (cancellationFee.ts, pure); the caller passes its
 * service-role client, so the edge test harness runs the REAL module.
 * Guard: src/test/edge/continueDayHold.test.ts.
 */
import { caughtMessage } from "./caughtMessage.ts";
import { jobLocalStartMs } from "./cancellationFee.ts";

/** The statuses that hold a job: a day proposed by the Helpr and not answered, or a day the poster set. */
const CONTINUE_DAY_ACTIVE_STATUSES = ["proposed", "set"] as const;

/** Hours past a continue day's start that it still holds the job: the working day it was set for. */
export const CONTINUE_DAY_HOLD_GRACE_HOURS = 6;

const tableMissing = (error: unknown) => {
  const code = String((error as { code?: string } | null)?.code ?? "");
  return code === "42P01" || code === "PGRST205";
};

/** A continue day whose start + grace has passed, still open. Its day replaces the job's in the stalled ladder. */
export type LapsedContinueDay = { status: "proposed" | "set"; new_date: string; new_start_time: string };

export type ContinuingRead =
  | { ok: true; jobs: Set<string>; lapsed: Map<string, LapsedContinueDay> }
  | { ok: false; message: string };

/** Which of `jobIds` an active continue day still holds (`jobs`), and which have one that has lapsed. Fails closed. */
export async function loadContinuingJobs(
  db: { from: (t: string) => any },
  jobIds: ReadonlyArray<string | null | undefined>,
  now: Date = new Date(),
): Promise<ContinuingRead> {
  const ids = [...new Set(jobIds.filter((x): x is string => typeof x === "string" && x.length > 0))];
  const jobs = new Set<string>();
  const lapsed = new Map<string, LapsedContinueDay>();
  if (ids.length === 0) return { ok: true, jobs, lapsed };
  let res: { data: Array<{ job_id: string; status: string; new_date?: string | null; new_start_time?: string | null }> | null; error: { message?: string; code?: string } | null };
  try {
    res = await db
      .from("job_continue_days")
      .select("job_id, status, new_date, new_start_time")
      .in("job_id", ids)
      .in("status", [...CONTINUE_DAY_ACTIVE_STATUSES]);
  } catch (err) {
    // Not silent: the failure goes back to the caller as { ok: false, message }, which reports it.
    return { ok: false, message: caughtMessage(err) };
  }
  if (res.error) {
    if (tableMissing(res.error)) return { ok: true, jobs, lapsed };
    return { ok: false, message: res.error.message ?? "continue day read failed" };
  }
  const graceMs = CONTINUE_DAY_HOLD_GRACE_HOURS * 3_600_000;
  for (const row of res.data ?? []) {
    if (!row || !ids.includes(row.job_id) || !(CONTINUE_DAY_ACTIVE_STATUSES as readonly string[]).includes(row.status)) continue;
    const startMs = typeof row.new_date === "string" && row.new_date
      ? jobLocalStartMs(row.new_date, typeof row.new_start_time === "string" ? row.new_start_time : null)
      : Number.NaN;
    if (Number.isFinite(startMs) && now.getTime() >= startMs + graceMs) {
      lapsed.set(row.job_id, { status: row.status as LapsedContinueDay["status"], new_date: row.new_date!, new_start_time: row.new_start_time ?? "00:00:00" });
    } else {
      jobs.add(row.job_id); // not yet over, or no readable day: held
    }
  }
  // Owner #4 (11-08, 20261108214605): a missed continue day reported ("Didn't come back" / "Can't come back") holds the
  // job until an admin acts: no escalation, no instant release, no stalled nudge, no approve ask. Same fail-closed rule.
  let missed: { data: Array<{ job_id: string }> | null; error: { message?: string; code?: string } | null };
  try {
    missed = await db.from("job_missed_returns").select("job_id").in("job_id", ids).is("resolved_at", null);
  } catch (err) {
    // Not silent: the failure goes back to the caller as { ok: false, message }, which reports it.
    return { ok: false, message: caughtMessage(err) };
  }
  if (missed.error) {
    if (!tableMissing(missed.error)) return { ok: false, message: missed.error.message ?? "missed return read failed" };
  } else {
    for (const row of missed.data ?? []) {
      if (!row || !ids.includes(row.job_id)) continue;
      jobs.add(row.job_id); // reported missed: held until an admin acts
      lapsed.delete(row.job_id);
    }
  }
  return { ok: true, jobs, lapsed };
}

/** Is this job held by a continue day? An unread check holds it (fail closed). */
export function heldByContinueDay(read: ContinuingRead, jobId: string): boolean {
  return !read.ok || read.jobs.has(jobId);
}

/** The job's lapsed continue day, if it has one (null when held, unread, or none). */
export function lapsedContinueDay(read: ContinuingRead, jobId: string): LapsedContinueDay | null {
  return read.ok ? read.lapsed.get(jobId) ?? null : null;
}

/** An instant release (not the poster's approval) also waits on a lapsed day that was only proposed, never agreed. */
export function heldForInstantRelease(read: ContinuingRead, jobId: string): boolean {
  return heldByContinueDay(read, jobId) || lapsedContinueDay(read, jobId)?.status === "proposed";
}

/**
 * Lead 11-08: a done on a continue day WITHOUT an after photo from that day is allowed (the 1.0.4 app build cannot add
 * one once day-1 photos exist) but MARKED (job_continue_days.done_without_new_photo_at = that completion's
 * helper_completed_at, 20261108160000). Nothing approves such a completion automatically: the poster or Helpr support
 * decides. Which of `jobs` carry the mark on their CURRENT completion. Fails closed (an unread check marks every job);
 * a missing column or table (the deploy window) marks none.
 */
export async function loadNoNewPhotoCompletions(
  db: { from: (t: string) => any },
  jobs: ReadonlyArray<{ id: string; helper_completed_at?: string | null }>,
): Promise<{ ok: true; jobs: Set<string> } | { ok: false; message: string }> {
  const done = jobs.filter((j) => typeof j.id === "string" && !!j.helper_completed_at);
  const marked = new Set<string>();
  if (done.length === 0) return { ok: true, jobs: marked };
  let res: { data: Array<{ job_id: string; done_without_new_photo_at: string | null }> | null; error: { message?: string; code?: string } | null };
  try {
    res = await db
      .from("job_continue_days")
      .select("job_id, done_without_new_photo_at")
      .in("job_id", done.map((j) => j.id))
      .not("done_without_new_photo_at", "is", null);
  } catch (err) {
    // Not silent: the failure goes back to the caller as { ok: false, message }, which reports it.
    return { ok: false, message: caughtMessage(err) };
  }
  if (res.error) {
    const code = String(res.error.code ?? "");
    if (tableMissing(res.error) || code === "42703" || code === "PGRST204") return { ok: true, jobs: marked };
    return { ok: false, message: res.error.message ?? "continue day photo read failed" };
  }
  const stamp = new Map(done.map((j) => [j.id, Date.parse(j.helper_completed_at!)]));
  for (const row of res.data ?? []) {
    const at = row?.done_without_new_photo_at ? Date.parse(row.done_without_new_photo_at) : Number.NaN;
    if (row && stamp.has(row.job_id) && Number.isFinite(at) && at === stamp.get(row.job_id)) marked.add(row.job_id);
  }
  return { ok: true, jobs: marked };
}
