import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";

// Shared by charge.refunded, charge.dispute.created and charge.dispute.closed.
//
// All three of those handlers resolve the affected record by
// `jobs.stripe_payment_intent_id`. A GIFT CARD donation's PaymentIntent is
// written only to `gift_cards.stripe_payment_intent_id` and never reaches
// `jobs`, so before this module every one of them found no row and silently
// no-op'd on a refunded or charged-back gift. The credit kept
// `payment_status = 'paid'` — the exact value `redeem_gift_card` requires — and
// stayed fully spendable. Because a gift-funded job has no Stripe charge behind
// it, `release-payout` then pays the helper from the PLATFORM BALANCE. A donor
// could charge back $500 and the platform would fund the helper out of its own
// money plus the chargeback fee, with no alert anywhere.
//
// Lives in `handlers/` rather than `_shared/` on purpose: a new `_shared/*.ts`
// is substituted by `./mocks/shared.ts` in the edge test harness unless a
// passthrough rule is added, and it promotes the deploy from functions-deploy
// to deploy-all. `_chargebackHold.ts` and `_resolveUser.ts` set this precedent.

export interface GiftRevokeResult {
  outcome: "no_gift" | "revoked" | "unavailable";
  revokedCount: number;
  revokedCents: number;
  spentCount: number;
  spentCents: number;
  spentJobIds: string[];
}

const NO_GIFT: GiftRevokeResult = {
  outcome: "no_gift",
  revokedCount: 0,
  revokedCents: 0,
  spentCount: 0,
  spentCents: 0,
  spentJobIds: [],
};

/**
 * Revoke the unspent portion of a gift-card donation tree whose charge went
 * back to the donor.
 *
 * Returns `no_gift` for the overwhelmingly common case where the PaymentIntent
 * belongs to a job escrow rather than a gift — callers carry on to their normal
 * `jobs` path unchanged.
 *
 * THROWS on any real failure. That is the contract, not an oversight: the outer
 * webhook catches it, rolls back the idempotency row and returns 500 so Stripe
 * redelivers. A swallowed error here means money went back to the donor while
 * the credit stayed spendable — silently — which is the entire bug this closes.
 */
export async function revokeGiftCardForRefund(
  supabase: any,
  paymentIntentId: string | null,
  reason: string,
  logStep: (m: string, d?: unknown) => void,
): Promise<GiftRevokeResult> {
  if (!paymentIntentId) return NO_GIFT;

  const { data, error } = await supabase.rpc("revoke_gift_card_for_refund", {
    p_payment_intent_id: paymentIntentId,
    p_reason: reason,
  });

  if (error) {
    // PGRST202 = the RPC is not in the schema cache yet. Edge functions deploy
    // ahead of migrations, so there is a real window where this function exists
    // and the RPC does not. Throwing would 500 EVERY refund and dispute event
    // for the whole window, including the job ones that have nothing to do with
    // gifts. So page ops loudly — gift revocation is not armed — and let the
    // caller continue. Every other error throws.
    if ((error as { code?: string }).code === "PGRST202") {
      logStep("WARNING: revoke_gift_card_for_refund not deployed yet", { paymentIntentId });
      await postSlackOpsAlert({
        kind: "money_at_risk",
        severity: "critical",
        title: "Gift card revocation RPC missing — refunded gifts stay spendable",
        message:
          "`revoke_gift_card_for_refund` is not in the schema cache, so a refunded/disputed gift card was NOT revoked and its credit is still spendable. Deploy the migration, then re-run this event from the Stripe dashboard.",
        fields: { "Payment Intent": paymentIntentId, Reason: reason },
      });
      return { ...NO_GIFT, outcome: "unavailable" };
    }
    throw new Error(
      `revoke_gift_card_for_refund failed for ${paymentIntentId}: ${error.message}`,
    );
  }

  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row || row.outcome !== "revoked") return NO_GIFT;

  const result: GiftRevokeResult = {
    outcome: "revoked",
    revokedCount: Number(row.revoked_count ?? 0),
    revokedCents: Number(row.revoked_cents ?? 0),
    spentCount: Number(row.spent_count ?? 0),
    spentCents: Number(row.spent_cents ?? 0),
    spentJobIds: Array.isArray(row.spent_job_ids) ? (row.spent_job_ids as string[]) : [],
  };

  logStep("Gift card donation revoked after money went back", {
    paymentIntentId,
    reason,
    ...result,
  });

  // Already-spent value is deliberately NOT clawed back — that money reached a
  // helper who did the work, and reversing their escrow to settle the donor's
  // dispute makes an innocent third party pay. It is a real loss though, so it
  // is paged rather than logged: `critical` when the platform is out of pocket,
  // `warning` when the whole gift was still sitting unspent and nothing was lost.
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: result.spentCents > 0 ? "critical" : "warning",
    title:
      result.spentCents > 0
        ? "Gift card charge reversed AFTER the credit was spent — platform absorbed it"
        : "Gift card charge reversed — unspent credit revoked",
    message:
      result.spentCents > 0
        ? `A donor's gift charge was ${reason}ed after $${(result.spentCents / 100).toFixed(2)} of it had already funded ${result.spentCount} job(s). That value is NOT clawed back from the helper. $${(result.revokedCents / 100).toFixed(2)} of still-unspent credit was revoked.`
        : `A donor's gift charge was ${reason}ed. $${(result.revokedCents / 100).toFixed(2)} of unspent credit across ${result.revokedCount} row(s) was revoked. Nothing had been spent.`,
    fields: {
      "Payment Intent": paymentIntentId,
      Reason: reason,
      "Revoked (unspent)": `$${(result.revokedCents / 100).toFixed(2)} / ${result.revokedCount} row(s)`,
      "Already spent": `$${(result.spentCents / 100).toFixed(2)} / ${result.spentCount} job(s)`,
      "Spent job ids": result.spentJobIds.join(", ") || "—",
    },
  });

  return result;
}

/**
 * A PARTIAL refund against a gift donation.
 *
 * Deliberately does NOT revoke. Revoking is all-or-nothing by design (the tree
 * walk has no notion of "80% of a credit"), so auto-revoking a $500 gift
 * because $1 went back as a goodwill gesture would destroy value the donor
 * never asked to reclaim. But staying silent is what this whole module exists
 * to stop, so a human is paged to decide.
 *
 * Read-only: one indexed lookup on the PaymentIntent, and nothing is written.
 */
export async function alertPartialGiftRefund(
  supabase: any,
  paymentIntentId: string | null,
  refundedCents: number,
  logStep: (m: string, d?: unknown) => void,
): Promise<boolean> {
  if (!paymentIntentId) return false;

  const { data, error } = await supabase
    .from("gift_cards")
    .select("id, amount, status, payment_status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  // Never drop this error. A dropped one reads as "not a gift", which is the
  // silent no-op this module was written to end.
  if (error) {
    throw new Error(
      `gift_cards lookup failed for partially refunded ${paymentIntentId}: ${error.message}`,
    );
  }
  if (!data) return false;

  logStep("Partial refund on a gift donation — not auto-revoked", { paymentIntentId });
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: "critical",
    title: "Gift card donation PARTIALLY refunded — credit left spendable on purpose",
    message:
      "Part of a gift donation went back to the donor. The credit was NOT revoked, because revocation is all-or-nothing and would destroy value the donor did not reclaim. Decide manually whether to revoke it.",
    fields: {
      "Payment Intent": paymentIntentId,
      "Gift card id": String(data.id),
      "Face value": `$${Number(data.amount).toFixed(2)}`,
      "Refunded": `$${(refundedCents / 100).toFixed(2)}`,
      "Current state": `${data.status} / ${data.payment_status}`,
    },
  });
  return true;
}

/**
 * A chargeback against a gift donation reached its final state.
 *
 * REPORT ONLY — deliberately no state change, in either direction.
 *
 * On "lost" the credit was already revoked when the dispute opened and must
 * stay revoked. On "won" the platform got the money back, so the recipient's
 * gift arguably deserves to come back too — but un-revoking is MINTING
 * spendable value from a webhook, and every other mint in this system is
 * guarded (unique index, dedupe row, or a locked RPC). A `charge.dispute.closed`
 * redelivery is not, so auto-restoring would re-mint on every replay. A human
 * flips `payment_status` back to 'paid' after checking. Rare enough to be worth
 * the manual step; dangerous enough to be worth refusing to automate.
 */
export async function alertGiftDisputeClosed(
  supabase: any,
  paymentIntentId: string | null,
  outcome: string,
  logStep: (m: string, d?: unknown) => void,
): Promise<boolean> {
  if (!paymentIntentId) return false;

  const { data, error } = await supabase
    .from("gift_cards")
    .select("id, amount, status, payment_status")
    .eq("stripe_payment_intent_id", paymentIntentId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `gift_cards lookup failed for closed dispute ${paymentIntentId}: ${error.message}`,
    );
  }
  if (!data) return false;

  const won = outcome === "won";
  logStep("Chargeback on a gift donation closed", { paymentIntentId, outcome });
  await postSlackOpsAlert({
    kind: "money_at_risk",
    severity: won ? "warning" : "critical",
    title: won
      ? "Gift card chargeback WON — revoked credit can be restored by hand"
      : "Gift card chargeback LOST — credit stays revoked",
    message: won
      ? "The platform won this chargeback, so the funds are back. The gift credit was revoked when the dispute opened and is NOT auto-restored — un-revoking is a mint and a redelivered event would repeat it. Set payment_status back to 'paid' manually if the gift should live again."
      : "The cardholder won this chargeback. The gift credit was revoked when the dispute opened and correctly stays revoked.",
    fields: {
      "Payment Intent": paymentIntentId,
      Outcome: outcome,
      "Gift card id": String(data.id),
      "Face value": `$${Number(data.amount).toFixed(2)}`,
      "Current state": `${data.status} / ${data.payment_status}`,
    },
  });
  return true;
}
