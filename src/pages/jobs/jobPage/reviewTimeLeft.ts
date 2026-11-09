import { APPROVAL_WINDOW_HOURS } from "../../../../supabase/functions/_shared/escrowTiming";

/** "23h 52m left, then Helpr support steps in", or, once the window passed, that support reaches out. */
export function reviewTimeLeft(deadlineMs: number, now = Date.now()): string {
  const ms = deadlineMs - now;
  if (ms <= 0) return `${APPROVAL_WINDOW_HOURS} hours passed. Helpr support will reach out; your payment stays held`;
  const mins = Math.floor(ms / 60_000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h > 0 ? `${h}h ${m}m` : `${m}m`} left, then Helpr support steps in`;
}
