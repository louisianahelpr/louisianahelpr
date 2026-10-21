import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isNotDeployedYet } from "@/lib/seriesDates";
import { helperTakeHomeDollars, type HelperEarningsJob } from "@/lib/helperEarnings";
import { rpcErrorMessage } from "./errorCopy";

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
export type RefundStatus = "open" | "agreed" | "declined" | "finish_offered" | "expired" | "closed";

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
  return !latest || !isWaiting(latest);
}

/** Open, or declined with its dispute not filed yet: the request still waits on something. */
export function isWaiting(r: RefundRequest): boolean {
  return r.status === "open" || (r.status === "declined" && !r.dispute_id);
}

/**
 * Can the Helpr offer to come back and finish? The schedule-change request's
 * own rule (request_job_schedule_change): a booked one-time job not started
 * and not marked done, with its start still ahead. Hidden otherwise: offering
 * it there could only be refused.
 */
export function canOfferToFinish(job: RefundJob, now: Date = new Date()): boolean {
  if (job.status !== "accepted" || job.helper_completed_at || !job.date_needed) return false;
  if (job.is_group_job || job.parent_job_id || (job.recurrence_days?.length ?? 0) > 0) return false;
  const start = Date.parse(`${job.date_needed}T${(job.start_time ?? "00:00").slice(0, 5)}:00`);
  return Number.isFinite(start) && start > now.getTime();
}

/** "$20" for whole dollars, "$20.50" otherwise (the server's own format). */
export function refundDollars(cents: number): string {
  if (!Number.isFinite(cents)) return "$0";
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * What the Helpr keeps if they agree: their share of the price (the price less
 * the amount asked back) and the same share of any urgent bonus, after their
 * fee, rounded down to the whole dollar a payout really is. The SAME rule the
 * split pays by (execute-dispute-split: budget x share + urgent x share -
 * jobHelprCommissionDollars, roundPayoutDownCents), through the take-home
 * function every Helpr earnings screen uses; a disputed-style settlement never
 * takes the one-time setup fee (Q1272 (3)). Parity: src/test/refundRequestTakeHome.test.ts.
 */
export function refundTakeHomeDollars(job: RefundJob, r: Pick<RefundRequest, "amount_cents" | "budget_cents">, feeFallbackPercent: number): number {
  const helperShare = Math.max(0, (r.budget_cents - r.amount_cents) / r.budget_cents);
  const scaled: HelperEarningsJob = {
    budget: (r.budget_cents - r.amount_cents) / 100,
    urgent_fee: (job.urgent_fee ?? 0) * helperShare,
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
