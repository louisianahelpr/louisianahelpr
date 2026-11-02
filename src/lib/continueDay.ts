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
import { rpcErrorMessage } from "@/lib/lifecycleErrors";

/** Continue another day's one name, on the poster's side and the Helpr's (the owner's words; Jobs audit 1102b, Q2593). */
export const CONTINUE_DAY_LABEL = "Not finished? Set a day";

export type { ContinueDay } from "./continueDayWords";
export { continueDayLabel, continueDayNextStep, continueDayAhead, continueDayDoneNote, continueDayHeader, jobOnContinueDay } from "./continueDayWords";
export { fetchContinueDay } from "./continueDayReads";

type ContinueRpc = "propose_job_continue_day" | "answer_job_continue_day" | "confirm_job_continue_day";

/** A refusal in plain words (never a raw code), from the shared RPC_ERROR_COPY table, else null. */
export function continueDayError(error: unknown, rpc: ContinueRpc = "propose_job_continue_day"): string | null {
  return rpcErrorMessage(rpc, error);
}

function fail(error: unknown, copy: string | null = null): never {
  throw new Error(copy ?? continueDayError(error) ?? "Couldn't save that. Check your connection and try again.");
}

/** The Helpr asks for another day, or the poster sets it (the server decides which from who calls). */
export async function proposeContinueDay(jobId: string, date: string, time: string, note: string): Promise<{ status: "proposed" | "set" }> {
  const { data, error } = await supabase.rpc("propose_job_continue_day", {
    p_job_id: jobId,
    p_date: date,
    p_start_time: time.length === 5 ? `${time}:00` : time,
    p_note: note.trim() || undefined,
  });
  if (error) fail(error, rpcErrorMessage("propose_job_continue_day", error));
  return { status: ((data as { status?: string } | null)?.status === "set" ? "set" : "proposed") };
}

/** The poster confirms the Helpr's day (one tap) or declines it. */
export async function answerContinueDay(continueId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("answer_job_continue_day", { p_continue_id: continueId, p_accept: accept });
  if (error) fail(error, rpcErrorMessage("answer_job_continue_day", error));
}

/** The Helpr confirms they'll be there on the new day. */
export async function confirmContinueDay(continueId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_job_continue_day", { p_continue_id: continueId });
  if (error) fail(error, rpcErrorMessage("confirm_job_continue_day", error));
}
