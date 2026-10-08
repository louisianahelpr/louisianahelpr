import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { isNotDeployedYet } from "@/lib/seriesDates";

/**
 * A booked one-time job's date/time change request (Q407 (8),
 * 20260927012807). Either party asks; only the other answers; nothing changes
 * until it is accepted; it expires at the job's original start.
 */
export interface ScheduleChangeRequest {
  id: string;
  job_id: string;
  requested_by: string;
  responder_id: string;
  old_date: string;
  old_start_time: string | null;
  new_date: string;
  new_start_time: string | null;
  status: string;
  expires_at: string;
}

/**
 * The job's live request, or null. A 'pending' row past expires_at is
 * expired (the RPC marks it so the next time anyone touches it), so it is
 * not returned. Not deployed yet (42P01 / PGRST205) is null.
 */
export async function fetchPendingScheduleChange(jobId: string, now: Date = new Date()): Promise<ScheduleChangeRequest | null> {
  const result = await supabase
    .from("job_schedule_change_requests")
    .select("id, job_id, requested_by, responder_id, old_date, old_start_time, new_date, new_start_time, status, expires_at")
    .eq("job_id", jobId)
    .eq("status", "pending")
    .maybeSingle();
  if (isNotDeployedYet(result.error)) return null;
  const row = unwrap(result) as ScheduleChangeRequest | null;
  if (!row || Date.parse(row.expires_at) <= now.getTime()) return null;
  return row;
}

function changeError(error: { code?: string | null; message?: string | null }, copy: string | null): Error {
  if (isNotDeployedYet(error)) {
    return new Error("This is briefly unavailable while an update finishes rolling out. Please try again in a few minutes.");
  }
  return new Error(copy ?? error.message ?? "Something went wrong. Please try again.");
}

export async function requestScheduleChange(jobId: string, date: string, startTime: string | null): Promise<void> {
  const { error } = await supabase.rpc("request_job_schedule_change", {
    p_job_id: jobId,
    p_date: date,
    // NULL = no set start time. `supabase gen types` types every SQL argument
    // as non-null; the function takes NULL for a time.
    p_start_time: startTime as string,
  });
  if (error) throw changeError(error, rpcErrorMessage("request_job_schedule_change", error));
}

/**
 * Returns the request's resulting status: accepted / declined / expired
 * ("expired:<reason>" when the server says why), or "clash" when an accept found the Helpr already booked at the new time (Q1262:
 * the server declines the request and tells whoever asked).
 */
export async function respondScheduleChange(requestId: string, accept: boolean): Promise<string> {
  const { data, error } = await supabase.rpc("respond_job_schedule_change", {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) throw changeError(error, rpcErrorMessage("respond_job_schedule_change", error));
  const reply = (data as { status?: string; reason?: string } | null) ?? {};
  if (reply.status === "declined" && reply.reason === "schedule_change_clash") return "clash";
  // Why an answer found the request expired (20261008183640); the person who
  // asked is told the same by notification.
  if (reply.status === "expired" && reply.reason) return `expired:${reply.reason}`;
  return String(reply.status ?? "");
}
