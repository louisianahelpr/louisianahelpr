/**
 * Q2399: the poster's own card hold on a job, for the "Your card is on hold"
 * line (get_my_job_card_hold, behind card_hold_at_post; READ only). Null
 * when there is none or it cannot be read; the read error is returned so the
 * caller reports it.
 */
import { supabase } from "@/integrations/supabase/client";
import { rpcErrorMessage } from "@/lib/lifecycleErrors";
import { report } from "@/lib/errorLogger";
import { CARD_HOLD_COPY } from "../../supabase/functions/_shared/cardHoldCopy";

type MyCardHold = { state: string; amount_cents: number; onboarding_fee_cents: number } | null;

async function fetchMyCardHold(jobId: string): Promise<{ hold: MyCardHold; error: unknown; message?: string }> {
  const { data, error } = await supabase.rpc("get_my_job_card_hold", { p_job_id: jobId });
  if (error) return { hold: null, error, message: rpcErrorMessage("get_my_job_card_hold", error) ?? undefined };
  const row = Array.isArray(data) ? (data[0] as { state?: string; amount_cents?: number; onboarding_fee_cents?: number } | undefined) : undefined;
  return { hold: row && typeof row.state === "string" ? { state: row.state, amount_cents: Number(row.amount_cents), onboarding_fee_cents: Number(row.onboarding_fee_cents ?? 0) } : null, error: null };
}

/**
 * PaymentSuccess's line for a job whose card is only HELD (payment_status 'held'): nothing is charged until the
 * poster hires. The amount is the hold's own; null when it cannot be read, and then the sentence names no amount.
 */
export type CardHoldLine = { scheduled: boolean; amountCents: number | null; feeCents?: number };

export async function readCardHoldLine(jobId: string): Promise<CardHoldLine> {
  const { hold, error } = await fetchMyCardHold(jobId);
  if (error) report(error, { tags: { source: "PaymentSuccess.cardHold" } });
  return { scheduled: hold?.state === "scheduled", amountCents: hold && Number.isFinite(hold.amount_cents) ? hold.amount_cents : null, feeCents: hold?.onboarding_fee_cents ?? 0 };
}

export function cardHoldSentence(line: CardHoldLine): string {
  if (line.amountCents == null) {
    // The hold could not be read (or has no row yet): never claim a hold that may not exist,
    // nor a hold on a far-out job whose card is only saved (Q2399 round 2, silent #10).
    return "Your job is posted. You're only charged when you hire someone.";
  }
  return line.scheduled ? CARD_HOLD_COPY.scheduled(line.amountCents, line.feeCents ?? 0) : CARD_HOLD_COPY.held(line.amountCents, line.feeCents ?? 0);
}
