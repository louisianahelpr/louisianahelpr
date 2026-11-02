/**
 * COULDN'T FINISH: CONTINUE ANOTHER DAY (owner 2026-11-01, Yusef's job: "he couldn't finish today so he will go back
 * Thursday ... so if this happens again we can move the day"). The client half of migration 20261101231015:
 *   - the active continue day of a job (public.job_continue_days, 'proposed' or 'set'),
 *   - the three calls (propose: the Helpr asks / the poster sets; answer: the poster confirms or declines; confirm:
 *     the Helpr says they'll be there),
 *   - the job's next-step line while it continues ("Continuing Thu 11/5 at 9 AM · waiting on Yusef").
 * The server does every check (party, ban, block, in progress, 1 hour to 30 days out); the words here only explain.
 * Guard: src/lib/continueDay.test.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

export type { ContinueDay } from "./continueDayWords";
export { continueDayLabel, continueDayNextStep, continueDayWords, continueDayAhead, continueDayHeader, jobOnContinueDay } from "./continueDayWords";
import type { ContinueDay } from "./continueDayWords";

/** The job's active continue day, or null. */
export async function fetchContinueDay(jobId: string): Promise<ContinueDay | null> {
  const rows = unwrap(
    await supabase
      .from("job_continue_days")
      .select("id, job_id, proposed_by, new_date, new_start_time, note, status, helper_confirmed_at")
      .eq("job_id", jobId)
      .in("status", ["proposed", "set"])
      .limit(1),
  ) as ContinueDay[] | null;
  return rows?.[0] ?? null;
}

type ContinueRpc = "propose_job_continue_day" | "answer_job_continue_day" | "confirm_job_continue_day";

/** A refusal in plain words (never a raw code), from the shared RPC_ERROR_COPY table, else null. */
export function continueDayError(error: unknown, rpc: ContinueRpc = "propose_job_continue_day"): string | null {
  return rpcErrorMessage(rpc, error);
}

function fail(rpc: ContinueRpc, error: unknown): never {
  throw new Error(continueDayError(error, rpc) ?? "Couldn't save that. Check your connection and try again.");
}

/** The Helpr asks for another day, or the poster sets it (the server decides which from who calls). */
export async function proposeContinueDay(jobId: string, date: string, time: string, note: string): Promise<{ status: "proposed" | "set" }> {
  const { data, error } = await supabase.rpc("propose_job_continue_day", {
    p_job_id: jobId,
    p_date: date,
    p_start_time: time.length === 5 ? `${time}:00` : time,
    p_note: note.trim() || undefined,
  });
  if (error) fail("propose_job_continue_day", error);
  return { status: ((data as { status?: string } | null)?.status === "set" ? "set" : "proposed") };
}

/** The poster confirms the Helpr's day (one tap) or declines it. */
export async function answerContinueDay(continueId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("answer_job_continue_day", { p_continue_id: continueId, p_accept: accept });
  if (error) fail("answer_job_continue_day", error);
}

/** The Helpr confirms they'll be there on the new day. */
export async function confirmContinueDay(continueId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_job_continue_day", { p_continue_id: continueId });
  if (error) fail("confirm_job_continue_day", error);
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
      .select("id, job_id, proposed_by, new_date, new_start_time, note, status, helper_confirmed_at")
      .in("job_id", [...jobIds])
      .in("status", ["proposed", "set"]),
  ) as ContinueDay[] | null;
  return Object.fromEntries((rows ?? []).map((r) => [r.job_id, r]));
}
