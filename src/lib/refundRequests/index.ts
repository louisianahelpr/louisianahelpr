import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isNotDeployedYet } from "@/lib/seriesDates";
import { helperTakeHomeDollars, type HelperEarningsJob } from "@/lib/helperEarnings";
import { rpcErrorMessage } from "./errorCopy";
import { agreedRushRefundCents } from "../../../supabase/functions/_shared/refundRush";

/**
 * Board 141, Jobs side (docs/OPEN.md Q2272; migration 20261021102943).
 *
 * The person who posted a job asks the Helpr for part or all of the money
 * back while it is held. The Helpr answers within 2 days: Agree (the money
 * moves on its own, through the same split an admin decision uses), Come back
 * and finish (the existing date/time request), or I don't agree (Helpr
 * decides, as a normal dispute). No answer in 2 days goes to Helpr too.
 *
 * Everything that matters is the server's: the amount is checked against the
 * job's own price, 'all' is the whole price whatever is sent, the shares come
 * from the stored request, and no money moves without the Helpr's recorded
 * agreement. This module only reads the request and calls the two RPCs.
 */

export type RefundScope = "part" | "all";
export type RefundAnswer = "agree" | "finish" | "decline";
export type RefundStatus = "open" | "agreed" | "declined" | "finish_offered" | "coming_back" | "expired" | "closed";

export interface RefundRequest {
  id: string;
  job_id: string;
  requester_id: string | null;
  responder_id: string | null;
  refund_scope: RefundScope;
  amount_cents: number;
  budget_cents: number;
  reason: string;
  status: RefundStatus;
  answer_by: string;
  answered_at: string | null;
  dispute_id: string | null;
  created_at: string;
}

const COLUMNS =
  "id, job_id, requester_id, responder_id, refund_scope, amount_cents, budget_cents, reason, status, answer_by, answered_at, dispute_id, created_at";

/** This job's newest refund request the viewer can read (RLS: its two parties), or null. */
export async function fetchLatestRefundRequest(jobId: string): Promise<RefundRequest | null> {
  const result = await supabase
    .from("refund_requests")
    .select(COLUMNS)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // The table is not deployed yet (migration lag): no request can exist.
  if (isNotDeployedYet(result.error)) return null;
  return (unwrap(result) as RefundRequest | null) ?? null;
}

/** The job fields the client reads to decide what to offer. */
export interface RefundJob {
  id: string;
  status: string;
  payment_status?: string | null;
  helper_id?: string | null;
  customer_id?: string | null;
  is_group_job?: boolean | null;
  parent_job_id?: string | null;
  recurrence_days?: number[] | null;
  budget: number | null;
  urgent_fee?: number | null;
  helper_fee_percent?: number | null;
  helper_fee_flat_cents?: number | null;
  helper_completed_at?: string | null;
  date_needed?: string | null;
  start_time?: string | null;
}

/**
 * Should the poster be OFFERED "Ask for a refund" on this job? The server's
 * own rule (refund_request_assert_job_open) for a job under way: one-time,
 * one Helpr, money held, no dispute. The server refuses anything else anyway;
 * this only keeps the button off a card where it could only fail.
 */
export function canAskForRefund(job: RefundJob, viewerId: string, latest: RefundRequest | null): boolean {
  if (job.customer_id !== viewerId || !job.helper_id) return false;
  if (job.is_group_job || job.parent_job_id || (job.recurrence_days?.length ?? 0) > 0) return false;
  if (job.status !== "in_progress" && job.status !== "revision_requested") return false;
  if (job.payment_status !== "escrow") return false;
  return !latest || !blocksNewAsk(latest);
}

/** Open, or declined with its dispute not filed yet: the request still waits on something. */
export function isWaiting(r: RefundRequest): boolean {
  return r.status === "open" || (r.status === "declined" && !r.dispute_id);
}

/**
 * A request the poster cannot ask again over: waiting, a come-back offer not
 * yet settled (Q2326), or agreed (its money is being settled). The server
 * refuses a second ask then too: refund_request_already_open while any
 * request on the job is live (refund_request_is_live), or the decided
 * dispute (refund_request_dispute_open).
 */
export function blocksNewAsk(r: RefundRequest): boolean {
  return isWaiting(r) || r.status === "finish_offered" || r.status === "coming_back" || r.status === "agreed";
}

/**
 * Can the Helpr offer to come back and finish? The schedule-change request's
 * own rule (request_job_schedule_change): a one-time job either UNDER WAY
 * (Q2326, owner 2026-10-21: only while answering this refund request, which
 * is the only place this is asked), or booked, not started and not marked
 * done, with its start still ahead. Hidden otherwise: offering it there could
 * only be refused.
 */
export function canOfferToFinish(job: RefundJob, now: Date = new Date()): boolean {
  if (job.is_group_job || job.parent_job_id || (job.recurrence_days?.length ?? 0) > 0) return false;
  if (job.status === "in_progress") return true;
  if (job.status !== "accepted" || job.helper_completed_at || !job.date_needed) return false;
  const start = Date.parse(`${job.date_needed}T${(job.start_time ?? "00:00").slice(0, 5)}:00`);
  return Number.isFinite(start) && start > now.getTime();
}

/**
 * The latest day a come-back may be offered for: 7 days from today in
 * Louisiana (rpc_answer_refund_request refuses a later one with
 * refund_request_finish_too_far). The request holds the payment while it
 * waits, so it cannot be pushed out without limit.
 */
export const COME_BACK_MAX_DAYS = 7;
export function latestComeBackDate(now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + COME_BACK_MAX_DAYS)).toISOString().slice(0, 10);
}

/** "$20" for whole dollars, "$20.50" otherwise (the server's own format). */
export function refundDollars(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** The job's rush (urgent) fee in cents, as the split reads it (netUrgentFeeDollars: whole, never negative). */
function rushCentsOf(job: Pick<RefundJob, "urgent_fee">): number {
  const cents = Math.round(Number(job.urgent_fee ?? 0) * 100);
  return cents > 0 ? cents : 0;
}

/**
 * The share of the rush fee an agreed PART refund also returns (owner
 * 2026-10-21: the same share as the price, no cliff), in cents. 0 with no rush
 * fee, and for All of it (that refund follows the full-refund rule instead).
 */
export function refundRushBackCents(job: Pick<RefundJob, "urgent_fee">, r: Pick<RefundRequest, "amount_cents" | "budget_cents">): number {
  if (!(r.amount_cents < r.budget_cents)) return 0;
  return agreedRushRefundCents(rushCentsOf(job), r.amount_cents, r.budget_cents);
}

/** What an agreed PART refund returns in all: the amount asked plus that share of the rush fee. */
export function refundPartTotalCents(job: Pick<RefundJob, "urgent_fee">, r: Pick<RefundRequest, "amount_cents" | "budget_cents">): number {
  return r.amount_cents + refundRushBackCents(job, r);
}

/**
 * What the Helpr keeps if they agree. Q2298 (owner, 2026-10-21): a part refund
 * returns EXACTLY the amount asked, plus the same share of the rush (urgent)
 * fee (owner, 2026-10-21), so the Helpr keeps the price less that amount and
 * the rest of the rush fee, after their fee, rounded down to the whole dollar a
 * payout really is; all of it leaves them nothing. The SAME rule the split pays
 * by (execute-dispute-split's exact agreed path: price - amount + rush - its
 * refunded share - jobHelprCommissionDollars, roundPayoutDownCents), through
 * the take-home function every Helpr earnings screen uses; a disputed-style
 * settlement never takes the one-time setup fee (Q1272 (3)). Parity:
 * src/test/refundRequestTakeHome.test.ts.
 */
export function refundTakeHomeDollars(job: RefundJob, r: Pick<RefundRequest, "amount_cents" | "budget_cents">, feeFallbackPercent: number): number {
  const part = r.amount_cents < r.budget_cents;
  const scaled: HelperEarningsJob = {
    budget: Math.max(0, r.budget_cents - r.amount_cents) / 100,
    urgent_fee: part ? (rushCentsOf(job) - refundRushBackCents(job, r)) / 100 : 0,
    helper_fee_percent: job.helper_fee_percent ?? null,
    helper_fee_flat_cents: job.helper_fee_flat_cents ?? null,
    is_group_job: false,
    helpers_needed: 1,
    // Not paid out yet: the fee is the one the payout will resolve.
    payment_status: "escrow",
    status: "disputed",
  };
  return Math.max(0, helperTakeHomeDollars(scaled, feeFallbackPercent, 0));
}

/** Ask the Helpr for money back. Returns the request id. */
export async function openRefundRequest(jobId: string, scope: RefundScope, amountCents: number | null, reason: string): Promise<string> {
  const { data, error } = await supabase.rpc("rpc_open_refund_request", {
    p_job_id: jobId,
    p_scope: scope,
    // NULL for 'all' (the server uses the whole price). `supabase gen types`
    // types every SQL argument as non-null.
    p_amount_cents: (scope === "all" ? null : amountCents) as number,
    p_reason: reason,
  });
  if (error) throw new Error(rpcErrorMessage("rpc_open_refund_request", error) ?? notDeployedOr(error));
  if (typeof data !== "string" || !data) throw new Error("We couldn't send that request. Refresh and check before trying again.");
  return data;
}

/** The Helpr's answer. `date`/`time` only for "finish" (the new time to come back). */
export async function answerRefundRequest(
  requestId: string,
  answer: RefundAnswer,
  finishAt: { date: string; time: string | null } | null = null,
): Promise<RefundStatus> {
  const { data, error } = await supabase.rpc("rpc_answer_refund_request", {
    p_request_id: requestId,
    p_answer: answer,
    p_date: (answer === "finish" ? finishAt?.date ?? null : null) as string,
    p_start_time: (answer === "finish" && finishAt?.time ? `${finishAt.time}:00` : null) as string,
  });
  if (error) throw new Error(rpcErrorMessage("rpc_answer_refund_request", error) ?? notDeployedOr(error));
  const status = (data as { status?: string } | null)?.status;
  if (status !== "agreed" && status !== "declined" && status !== "finish_offered") {
    throw new Error("We couldn't confirm your answer. Refresh and check before trying again.");
  }
  return status;
}

/** The poster takes back a request still waiting (open, or declined before the dispute is filed). */
export async function withdrawRefundRequest(requestId: string): Promise<void> {
  const { data, error } = await supabase.rpc("rpc_withdraw_refund_request", { p_request_id: requestId });
  if (error) throw new Error(rpcErrorMessage("rpc_withdraw_refund_request", error) ?? notDeployedOr(error));
  if ((data as { status?: string } | null)?.status !== "closed") {
    throw new Error("We couldn't confirm that. Refresh and check before trying again.");
  }
}

function notDeployedOr(error: { code?: string | null; message?: string | null }): string {
  if (isNotDeployedYet(error)) return "This is briefly unavailable while an update finishes rolling out. Please try again in a few minutes.";
  return "Something went wrong. Check your connection and try again.";
}
