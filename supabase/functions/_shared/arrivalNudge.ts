/**
 * Which arrival-confirm nudge a job is due for (VN-33, owner 2026-09-14:
 * "Nudge, then escalate").
 *
 *   first     — as soon as the Helpr's GPS arrival is verified
 *   second    — SECOND_AFTER_HOURS after that, if the poster still hasn't confirmed
 *   escalate  — ESCALATE_AFTER_HOURS after that: admin confirms or disputes
 *
 * Pure: no Deno or Supabase imports, so the vitest suite pins the schedule.
 */
export const SECOND_AFTER_HOURS = 2;
export const ESCALATE_AFTER_HOURS = 24;

export type NudgeLedger = {
  first_sent_at: string | null;
  second_sent_at: string | null;
  escalated_at: string | null;
} | null;

export type NudgeStage = "first" | "second" | "escalate" | null;

export function arrivalNudgeStage(
  verifiedAt: string,
  ledger: NudgeLedger,
  now: Date,
): NudgeStage {
  const hours = (now.getTime() - new Date(verifiedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(hours) || hours < 0) return null;
  if (!ledger?.first_sent_at) return "first";
  if (ledger.escalated_at) return null;
  // Never escalate straight after the first nudge. An arrival that was already
  // old when the nudges shipped (or when a run was missed) still gives the
  // poster SECOND_AFTER_HOURS to answer before admin is pulled in.
  const sinceFirst = (now.getTime() - new Date(ledger.first_sent_at).getTime()) / 3_600_000;
  if (hours >= ESCALATE_AFTER_HOURS && sinceFirst >= SECOND_AFTER_HOURS) return "escalate";
  if (!ledger.second_sent_at && sinceFirst >= SECOND_AFTER_HOURS) return "second";
  return null;
}
