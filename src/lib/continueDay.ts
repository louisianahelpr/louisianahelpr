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
import type { NextStepValue } from "@/components/ui/NextStep";

export type ContinueDay = {
  id: string;
  job_id: string;
  proposed_by: string | null;
  new_date: string;
  new_start_time: string;
  note: string | null;
  status: "proposed" | "set";
  helper_confirmed_at: string | null;
};

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Thu 11/5 at 9 AM" / "Thu 11/5 at 1:30 PM": the server's continue_day_label, the same words in every notice. */
export function continueDayLabel(date: string, time: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d || Number.isNaN(hh)) return "";
  const weekday = WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  const clock = mm ? `${h12}:${String(mm).padStart(2, "0")}` : `${h12}`;
  return `${weekday} ${m}/${d} at ${clock} ${hh < 12 ? "AM" : "PM"}`;
}

/**
 * The job's next-step line while it continues on another day, for the job's two people. Null when there is no
 * active continue day (the tracker's own line stands).
 */
export function continueDayNextStep(
  row: ContinueDay | null | undefined,
  o: { side: "poster" | "helpr"; otherFirst?: string | null },
): NextStepValue | null {
  if (!row) return null;
  const when = continueDayLabel(row.new_date, row.new_start_time);
  const other = (o.otherFirst ?? "").trim();
  if (row.status === "proposed") {
    return o.side === "poster"
      ? { who: "you", text: `Confirm ${other ? `${other}'s` : "your Helpr's"} new day`, by: when }
      : { who: "them", text: `You asked to finish ${when}`, by: `waiting on ${other || "the person who posted it"}` };
  }
  if (o.side === "poster") {
    return { who: "them", text: `Continuing ${when}`, by: `waiting on ${other || "your Helpr"}` };
  }
  return row.helper_confirmed_at
    ? { who: "info", text: `Continuing ${when}`, by: "mark it done when you finish" }
    : { who: "you", text: "Confirm you'll be there", by: `continuing ${when}` };
}

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

/** What each refusal says, in plain words. */
const REFUSAL: Record<string, string> = {
  continue_day_not_in_progress: "Another day can be set only while the job is under way.",
  continue_day_too_soon: "Pick a time at least an hour from now.",
  continue_day_too_far: "Pick a day within the next 30 days.",
  continue_day_invalid: "Pick a day and a time.",
  continue_day_note_too_long: "Keep the note under 300 characters.",
  continue_day_in_past: "That time has passed. Pick a new day.",
  continue_day_not_set: "There's no day set to confirm. Refresh and check.",
  users_blocked: "This can't be changed between you two.",
  account_restricted: "Your account can't make changes right now.",
  not_authorized: "Only the two people on this job can do that.",
};

/** A refusal in plain words (never a raw code), else null. */
export function continueDayError(error: unknown): string | null {
  const msg = String((error as { message?: string } | null)?.message ?? "");
  const code = Object.keys(REFUSAL).find((c) => new RegExp(`\\b${c}\\b`).test(msg));
  return code ? REFUSAL[code] : null;
}

function fail(error: unknown): never {
  throw new Error(continueDayError(error) ?? "Couldn't save that. Check your connection and try again.");
}

/** The Helpr asks for another day, or the poster sets it (the server decides which from who calls). */
export async function proposeContinueDay(jobId: string, date: string, time: string, note: string): Promise<{ status: "proposed" | "set" }> {
  const { data, error } = await supabase.rpc("propose_job_continue_day", {
    p_job_id: jobId,
    p_date: date,
    p_start_time: time.length === 5 ? `${time}:00` : time,
    p_note: note.trim() || undefined,
  });
  if (error) fail(error);
  return { status: ((data as { status?: string } | null)?.status === "set" ? "set" : "proposed") };
}

/** The poster confirms the Helpr's day (one tap) or declines it. */
export async function answerContinueDay(continueId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc("answer_job_continue_day", { p_continue_id: continueId, p_accept: accept });
  if (error) fail(error);
}

/** The Helpr confirms they'll be there on the new day. */
export async function confirmContinueDay(continueId: string): Promise<void> {
  const { error } = await supabase.rpc("confirm_job_continue_day", { p_continue_id: continueId });
  if (error) fail(error);
}
