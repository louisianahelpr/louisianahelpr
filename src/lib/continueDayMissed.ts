/**
 * Owner decision #4 (11-08): a continue day whose time passed without "Mark done". The poster gets "Didn't come back"
 * (optional photos of what's left plus a note), the Helpr gets "Can't come back" (a note). Either one sends the job to
 * Louisiana Helpr's admin queue (report_continue_day_missed, 20261108214605); no money moves, the admin decides.
 * Guard: src/test/continueDayMissedReturn.test.ts. PGlite: src/test/pglite/continueDayMissedReturn.pglite.mjs.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { unwrap } from "@/lib/supabaseResult";
import { jobLocalStartMs } from "../../supabase/functions/_shared/cancellationFee";

/** Hours past the agreed day's start before it counts as missed: the server's lapse (CONTINUE_DAY_HOLD_GRACE_HOURS). */
export const CONTINUE_DAY_MISSED_AFTER_HOURS = 6;

export const MISSED_LABEL_POSTER = "Didn't come back";
export const MISSED_LABEL_HELPR = "Can't come back";

/** The agreed (set) day has passed its start + 6 h and the Helpr has not marked the job done. */
export function continueDayMissedOpen(
  row: { status: string; new_date: string; new_start_time: string | null } | null | undefined,
  helperCompletedAt: string | null | undefined,
): boolean {
  if (!row || !row.new_date) return false;
  const done = !!helperCompletedAt;
  const startMs = jobLocalStartMs(row.new_date, row.new_start_time ?? null);
  if (!Number.isFinite(startMs)) return false;
  return row.status === "set" && !done && Date.now() >= startMs + CONTINUE_DAY_MISSED_AFTER_HOURS * 3_600_000;
}

/** Send the report. `photos` are proof-photos paths under `<uid>/disputes/<jobId>/` (the poster's only). */
export async function reportContinueDayMissed(jobId: string, note: string, photos: string[]): Promise<void> {
  const { error } = await supabase.rpc("report_continue_day_missed", {
    p_job_id: jobId,
    p_note: note.trim() || undefined,
    p_photos: photos,
  });
  if (error) throw new Error(rpcErrorMessage("report_continue_day_missed", error) ?? "Couldn't send that. Check your connection and try again.");
}

/** The job's open missed-return report (Louisiana Helpr is reviewing it), or null. A failed read throws (React Query). */
export async function fetchOpenMissedReturn(jobId: string): Promise<{ side: "poster" | "helpr"; created_at: string } | null> {
  const rows = unwrap(
    await supabase.from("job_missed_returns").select("side, created_at").eq("job_id", jobId).is("resolved_at", null).limit(1),
  ) as Array<{ side: "poster" | "helpr"; created_at: string }> | null;
  return rows?.[0] ?? null;
}
