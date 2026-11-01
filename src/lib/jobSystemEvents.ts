/**
 * jobSystemEvents — derive in-thread system messages from a job's
 * status-transition timestamps.
 *
 * The Messages page renders these as styled, centered `<div>` rows
 * (NOT real message bubbles) interleaved chronologically with the
 * real `messages` rows. They give both participants shared, in-thread
 * context for what happened on the job ("Helper marked on the way",
 * "The person who posted this job confirmed it complete", "Job cancelled by
 * the person who posted it") so
 * they don't have to jump to /jobs to see state changes.
 *
 * This is a pure derivation — no schema changes, no separate audit
 * table. The `jobs` table already records each transition's timestamp
 * (helper_on_the_way_at, helper_completed_at, cancelled_at, …); we
 * surface them in the thread.
 */

import { type PosterChargedJob } from "@/lib/posterJobCost";
import { jobIsExpiredListing, EXPIRED_IN_THREAD } from "@/lib/expiredListingInThread";
import { tipChargeBreakdown } from "../../supabase/functions/_shared/tipFees";
export type JobSystemEventKind =
  | "helper_on_the_way"
  | "helper_arrived"
  | "helper_completed"
  | "poster_confirmed_completed"
  | "revision_requested"
  | "cancelled"
  | "disputed"
  /** Board 181: a paid tip, a money pill ("Lexi tipped $13.50"). */
  | "tipped"
  /** Board 181: the payer's receipt for a finished job (job lines + tips). */
  | "receipt";

export interface JobSystemEvent {
  /** Stable id so the thread render can key on it (system-<kind>-<jobId>). */
  id: string;
  kind: JobSystemEventKind;
  at: string;
  /** Pre-rendered, voice-checked copy — kept here so the renderer stays
   *  a thin <div> with no branching on event kind. */
  label: string;
  /** Money events (tipped, receipt) wear the money tint (spec v2 §3 status bubbles). */
  money?: boolean;
  /** The receipt's lines, for kind "receipt" only. */
  receipt?: ChatReceipt;
}

/** One receipt, every line read from what was charged (posterJobCost, tipChargeBreakdown). */
export interface ChatReceipt {
  lines: { label: string; cents: number }[];
  totalCents: number;
}

/**
 * The subset of `public.jobs` fields needed to derive system events.
 * Kept narrow so callers (Messages.tsx openConvo) can hand-pick the
 * select list rather than dragging in every job column.
 */
export interface JobTimestamps {
  cancelled_at: string | null;
  cancelled_by: string | null;
  customer_id: string;
  helper_arrived_at: string | null;
  helper_completed_at: string | null;
  helper_id: string | null;
  helper_on_the_way_at: string | null;
  poster_completed_at: string | null;
  revision_requested_at: string | null;
  disputed_at: string | null;
  disputed_by: string | null;
  /** Read so an expired listing (isExpiredListing) is told apart from a cancellation. */
  cancellation_reason?: string | null;
  status?: string | null;
}

/**
 * Produce one short, sentence-case label per non-null transition.
 * Cancellation copy adapts to who cancelled (poster vs helper) using
 * `cancelled_by`; dispute copy uses `disputed_by` the same way.
 */
export function deriveJobSystemEvents(
  job: JobTimestamps | null | undefined,
  jobId: string,
  viewerId?: string | null,
): JobSystemEvent[] {
  if (!job) return [];
  const out: JobSystemEvent[] = [];

  if (job.helper_on_the_way_at) {
    out.push({
      id: `system-helper_on_the_way-${jobId}`,
      kind: "helper_on_the_way",
      at: job.helper_on_the_way_at,
      label: "Helpr marked on the way.",
    });
  }
  if (job.helper_arrived_at) {
    out.push({
      id: `system-helper_arrived-${jobId}`,
      kind: "helper_arrived",
      at: job.helper_arrived_at,
      label: "Helpr arrived at the location.",
    });
  }
  if (job.helper_completed_at) {
    out.push({
      id: `system-helper_completed-${jobId}`,
      kind: "helper_completed",
      at: job.helper_completed_at,
      label: "Helpr marked the job complete.",
    });
  }
  if (job.poster_completed_at) {
    out.push({
      id: `system-poster_confirmed_completed-${jobId}`,
      kind: "poster_confirmed_completed",
      at: job.poster_completed_at,
      label: "The person who posted this job confirmed it complete.",
    });
  }
  if (job.revision_requested_at) {
    out.push({
      id: `system-revision_requested-${jobId}`,
      kind: "revision_requested",
      at: job.revision_requested_at,
      label: "The person who posted this job requested a revision.",
    });
  }
  // An expired listing was never cancelled by anyone (owner 10-31): the poster reads that it expired, anyone else
  // that it is no longer open. Kind stays "cancelled" so buildTimeline still drops the stored "✕ Job cancelled" row.
  const expired = job.cancelled_at && jobIsExpiredListing(job)
    ? (viewerId && viewerId === job.customer_id ? EXPIRED_IN_THREAD.poster : EXPIRED_IN_THREAD.other)
    : null;
  if (job.cancelled_at && expired) {
    out.push({ id: `system-cancelled-${jobId}`, kind: "cancelled", at: job.cancelled_at, label: expired.event });
  } else if (job.cancelled_at) {
    const who =
      job.cancelled_by === job.customer_id
        ? "poster"
        : job.cancelled_by === job.helper_id
          ? "helper"
          : null;
    out.push({
      id: `system-cancelled-${jobId}`,
      kind: "cancelled",
      at: job.cancelled_at,
      label: who
        ? `Job cancelled by ${who === "poster" ? "the person who posted it" : "the Helpr"}.`
        : "Job was cancelled.",
    });
  }
  if (job.disputed_at) {
    const who =
      job.disputed_by === job.customer_id
        ? "poster"
        : job.disputed_by === job.helper_id
          ? "helper"
          : null;
    out.push({
      id: `system-disputed-${jobId}`,
      kind: "disputed",
      at: job.disputed_at,
      label: who
        ? `${who === "poster" ? "The person who posted this job" : "The Helpr"} opened a dispute.`
        : "A dispute was opened.",
    });
  }

  return out;
}

/** A paid tip on this job, as the tipper or the tipped Helpr may read it (tips RLS). */
export interface PaidTip {
  id: string;
  amount: number;
  created_at: string;
  tipper_id: string;
}

/** What the payer was charged for this job (posterJobCost's columns). */
export interface JobCharge extends PosterChargedJob {
  status: string;
  payment_status: string | null;
  poster_completed_at: string | null;
  customer_id: string | null;
  /** Set on a poster-fee job: customer_fee_amount is then the service fee, not only card processing. */
  poster_fee_flat_cents?: number | string | null;
  /** A legacy tier service fee (e.g. 12%) was stamped here: customer_fee_amount is that fee. */
  platform_fee_percent?: number | string | null;
  /** The card charge; a job with none was not paid by card. */
  stripe_payment_intent_id?: string | null;
  /** A dispute may have refunded part of it without a refund on the row. */
  disputed_at?: string | null;
}

/** Facts the receipt needs beyond the job row. */
export interface ReceiptContext {
  /** A gift card touched this job (or we could not tell): the card charge is not the price. */
  giftOrUnknown: boolean;
}

const cents = (d: number | null | undefined) => (typeof d === "number" && Number.isFinite(d) ? Math.round(d * 100) : 0);

/**
 * Board 181: the money facts of a deal-room thread. A pill per paid tip
 * ("Lexi tipped $13.50" / "You tipped $13.50"), and, for the person who paid,
 * a receipt once the job is done and paid out: Job, Urgent bonus, Card
 * processing, Tax, Setup fee, each tip and its card processing, Total. Every
 * figure is a stamped column or the tip charge function, never re-derived.
 * Nothing for a refunded or unpaid job (a receipt must not overstate).
 */
export function deriveMoneyEvents(
  job: JobCharge | null | undefined,
  tips: PaidTip[],
  viewerId: string,
  otherFirstName: string,
  jobId: string,
  ctx: ReceiptContext = { giftOrUnknown: true },
): JobSystemEvent[] {
  const out: JobSystemEvent[] = [];
  for (const t of tips) {
    const who = t.tipper_id === viewerId ? "You" : otherFirstName || "They";
    out.push({ id: `system-tipped-${t.id}`, kind: "tipped", at: t.created_at, label: `${who} tipped $${(cents(t.amount) / 100).toFixed(2)}`, money: true });
  }
  if (!job || job.customer_id !== viewerId) return out;
  if (job.status !== "completed" || !["released", "payout_pending"].includes(job.payment_status ?? "")) return out;
  // Only a plain card-paid job whose charge stands (money review, board 181): a
  // gift may have paid some or all of it, and a dispute may have refunded part
  // without a refund on the row. Then the receipt would overstate; none is shown.
  if (!job.stripe_payment_intent_id || job.disputed_at || ctx.giftOrUnknown) return out;
  // Owner 2026-10-25: members never see a fee line, only what they paid. A
  // card-cost or service fee an older job charged the poster is part of what
  // the job cost them, so it is in the Job line; a tip's card cost is in the
  // Tip line (what the tipper paid). The total is unchanged. The one fee shown
  // is the one-time account setup fee.
  const lines: { label: string; cents: number }[] = [{ label: "Job", cents: cents(job.budget) + Math.max(0, cents(job.customer_fee_amount)) }];
  if (cents(job.urgent_fee) > 0) lines.push({ label: "Urgent bonus", cents: cents(job.urgent_fee) });
  if (cents(job.sales_tax_amount) > 0) lines.push({ label: "Tax", cents: cents(job.sales_tax_amount) });
  if (cents(job.onboarding_fee_amount) > 0) lines.push({ label: "Account setup fee", cents: cents(job.onboarding_fee_amount) });
  for (const t of tips.filter((x) => x.tipper_id === viewerId)) {
    const q = tipChargeBreakdown(cents(t.amount));
    lines.push({ label: "Tip", cents: q.chargeCents });
  }
  const totalCents = lines.reduce((sum, l) => sum + l.cents, 0);
  const lastTip = tips.reduce((m, t) => (t.created_at > m ? t.created_at : m), "");
  const at = [job.poster_completed_at ?? "", lastTip].sort().pop() || job.poster_completed_at || new Date().toISOString();
  // A moment after the last money fact, so the receipt reads under its pills.
  const after = new Date(new Date(at).getTime() + 1000).toISOString();
  out.push({ id: `system-receipt-${jobId}`, kind: "receipt", at: after, label: "Receipt", money: true, receipt: { lines, totalCents } });
  return out;
}
