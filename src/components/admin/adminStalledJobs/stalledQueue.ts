/**
 * The stalled-job queue, as the admin console reads it.
 *
 * WHAT THIS QUEUE IS. `20260919143637_stalled_completion_nudges.sql` added the
 * sweep for a job that reaches `in_progress` and is never marked done by
 * either side: nobody's cron matched it, so its escrow was held indefinitely.
 * The sweep nudges both parties at +2h and +24h past the job's scheduled end,
 * and at +48h writes `escalated_at` — which is the queue. A row with
 * `escalated_at` set and `resolved_at` null is AWAITING A HUMAN.
 *
 * MONEY NEVER MOVES FROM HERE. The owner's rule (2026-09-19 pop-up: "Nudge
 * both, then admin queue. Never move money automatically.") is the reason the
 * third stage is a queue item rather than a transfer: nobody can prove from the
 * data whether the work happened. `resolve_stalled_job_flag` records that a
 * person looked; the release / refund itself stays on the dispute and job money
 * paths, which are the ones with the confirmations and the audit trail for it.
 *
 * Pure module: no React, no Supabase. The component imports it, and the tests
 * pin the arithmetic and the copy without rendering anything.
 */
import {
  STALLED_FIRST_AFTER_HOURS,
  STALLED_SECOND_AFTER_HOURS,
  STALLED_ESCALATE_AFTER_HOURS,
  hoursPastScheduledEnd,
} from "../../../../supabase/functions/_shared/stalledCompletion";

/** One row of `admin_stalled_job_queue(boolean)`, column for column. */
export interface StalledQueueRow {
  job_id: string;
  title: string | null;
  customer_id: string | null;
  helper_id: string | null;
  budget: number | null;
  date_needed: string | null;
  start_time: string | null;
  estimated_hours: number | null;
  status: string | null;
  payment_status: string | null;
  first_sent_at: string | null;
  second_sent_at: string | null;
  escalated_at: string | null;
  resolved_at: string | null;
  /** Q233: resolved client-side; admin_stalled_job_queue does not return it. */
  is_seed?: boolean;
}

/**
 * "The RPC is not on prod yet", told apart from every other failure.
 *
 * `admin_stalled_job_queue` and `resolve_stalled_job_flag` ship in a migration
 * that `db-deploy` has not run yet, so between this commit and that deploy
 * PostgREST answers PGRST202 ("Could not find the function"). That window is a
 * real, expected state — it must be SHOWN, not swallowed into an empty list,
 * because "no stuck jobs" and "I could not ask" are opposite answers on a
 * screen about held escrow.
 *
 * 42883 is the Postgres-side spelling of the same thing, and PGRST100/PGRST203
 * cover a signature the deployed schema cache does not know.
 */
const MISSING_RPC_CODES = new Set(["PGRST202", "PGRST203", "42883"]);

export function isMissingRpc(error: unknown): boolean {
  if (!error) return false;
  const code = String((error as { code?: string }).code ?? "");
  if (MISSING_RPC_CODES.has(code)) return true;
  const message = String((error as { message?: string }).message ?? "").toLowerCase();
  return (
    message.includes("could not find the function") ||
    message.includes("does not exist") ||
    message.includes("schema cache")
  );
}

/**
 * Hours past the job's scheduled end, from the SAME function the sweep used to
 * decide this row belonged here (`_shared/stalledCompletion.ts`). Importing it
 * rather than re-deriving is the point: the screen can never claim a job is 30h
 * stuck when the cron measured 54h.
 *
 * The completion stamps are passed as null because a row in this queue has
 * neither by definition — `hoursPastScheduledEnd` reads only the date fields.
 */
export function hoursStuck(row: StalledQueueRow, now: Date = new Date()): number {
  return hoursPastScheduledEnd(
    {
      status: row.status,
      helper_completed_at: null,
      poster_completed_at: null,
      date_needed: row.date_needed,
      start_time: row.start_time,
      estimated_hours: row.estimated_hours,
    },
    now,
  );
}

/**
 * "2d 6h past the scheduled end" — the one number that says how bad this is.
 *
 * A row whose `date_needed` was anonymised by a deleted poster (CLAUDE.md: a
 * job can outlive its poster) has no scheduled end at all, and says so rather
 * than rendering "NaN h".
 */
export function stuckLabel(row: StalledQueueRow, now: Date = new Date()): string {
  const hours = hoursStuck(row, now);
  if (!Number.isFinite(hours)) return "No scheduled end on record";
  if (hours < 0) return "Not past its scheduled end yet";
  const whole = Math.floor(hours);
  const days = Math.floor(whole / 24);
  const rest = whole % 24;
  const span = days > 0 ? `${days}d ${rest}h` : `${whole}h`;
  return `${span} past the scheduled end`;
}

export interface StalledStageView {
  key: "first" | "second" | "escalate";
  /** What the stage DID, in the reader's words. */
  label: string;
  /** The threshold it fires at, so the ladder explains itself. */
  atHours: number;
  /** When it actually fired, or null if it has not. */
  sentAt: string | null;
}

/** The three-rung ladder for one row, in order, with what has fired. */
export function stageLadder(row: StalledQueueRow): StalledStageView[] {
  return [
    {
      key: "first",
      label: "Both parties reminded",
      atHours: STALLED_FIRST_AFTER_HOURS,
      sentAt: row.first_sent_at,
    },
    {
      key: "second",
      label: "Reminded again",
      atHours: STALLED_SECOND_AFTER_HOURS,
      sentAt: row.second_sent_at,
    },
    {
      key: "escalate",
      label: "Escalated to this queue",
      atHours: STALLED_ESCALATE_AFTER_HOURS,
      sentAt: row.escalated_at,
    },
  ];
}

/** Only the rows still awaiting a person, whatever the RPC was asked for. */
export function awaitingHuman(rows: StalledQueueRow[]): StalledQueueRow[] {
  return rows.filter((r) => !!r.escalated_at && !r.resolved_at);
}

/**
 * The single sentence this screen exists to keep true. Rendered on the card and
 * asserted by `adminStalledJobs.test.tsx`, so the day someone adds a Release
 * button here, a test about that sentence is what stops them.
 */
export const STALLED_NO_MONEY_NOTE =
  "Nothing here moves money. Marking one reviewed only records that a person looked — " +
  "release or refund still goes through the job's own dispute path.";
