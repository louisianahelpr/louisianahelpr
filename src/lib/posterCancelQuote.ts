/**
 * The poster's cancel quote (boards 66/172 slice 2): create-payment's
 * `cancel_quote` action, read before the poster confirms a cancel.
 *
 * Every number here is the SERVER's: `back_to_you_cents` is
 * _shared/posterCancelSplit.ts, the same function void-cancelled-payments
 * refunds with, fed the charge's real Stripe fee, tax and earlier refunds; the
 * screen never works it out. `fee_cents` is the cancellation fee the quote
 * priced; the dialog passes it to poster_cancel_job as p_expected_fee_cents,
 * which refuses with quote_changed when the fee moved since.
 */
import { supabase } from "@/integrations/supabase/client";
import { report } from "@/lib/errorLogger";

export interface PosterCancelQuote {
  can_cancel: boolean;
  /** The cancellation fee this cancel would record, in cents (null for a crew). */
  fee_cents?: number | null;
  /** Its percent of the budget, from the same ladder. */
  fee_percent?: number | null;
  /** What goes back to the poster's card, in cents; null when the server will not quote it. */
  back_to_you_cents?: number | null;
  /** Why there is no amount (crew, gift, earlier_refund, unreadable, ...). */
  unquoted_reason?: string | null;
  /** 'hold': the rest of an uncaptured hold is released; 'captured': refunded. */
  charge_state?: "hold" | "captured" | null;
}

const isCents = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/**
 * Null when the quote could not be read (a failed call, a server that does not
 * have the action yet): the dialog then shows no amount and passes no expected
 * fee, the behaviour before the quote existed.
 */
export async function fetchPosterCancelQuote(jobId: string): Promise<PosterCancelQuote | null> {
  try {
    const { data, error } = await supabase.functions.invoke("create-payment", { body: { action: "cancel_quote", jobId } });
    if (error || !data || typeof data !== "object" || typeof (data as { can_cancel?: unknown }).can_cancel !== "boolean") {
      if (error) report(error, { severity: "warning", tags: { source: "posterCancelQuote" }, context: { job_id: jobId } });
      return null;
    }
    const q = data as PosterCancelQuote;
    return {
      can_cancel: q.can_cancel,
      fee_cents: isCents(q.fee_cents) ? q.fee_cents : null,
      fee_percent: typeof q.fee_percent === "number" ? q.fee_percent : null,
      back_to_you_cents: isCents(q.back_to_you_cents) ? q.back_to_you_cents : null,
      unquoted_reason: typeof q.unquoted_reason === "string" ? q.unquoted_reason : null,
      charge_state: q.charge_state === "hold" || q.charge_state === "captured" ? q.charge_state : null,
    };
  } catch (e) {
    // The cancel itself does not depend on the quote; only the amount line does.
    report(e, { severity: "warning", tags: { source: "posterCancelQuote" }, context: { job_id: jobId } });
    return null;
  }
}
