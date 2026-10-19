// seed-policy: pages for seed accounts too: an alert here is a paid ID check
// that could not be recorded, a platform failure whoever paid.
//
// The paid ID check (owner 2026-10-19: "they have to pay for their own ID").
// stripe-idv-start { action: "checkout" } opened this Checkout and wrote an
// 'awaiting_payment' row in public.idv_fee_payments. This marks it 'paid'. ONLY
// a 'paid' row lets stripe-idv-start create the VerificationSession, so the
// order is: payment confirmed here -> session created there, never the reverse.
//
// Throws on a DB error so stripe-webhook answers 500 and Stripe retries; a
// dropped write would leave a landlord charged with no check to show for it.
import type Stripe from "https://esm.sh/stripe@18.5.0";
import type { WebhookContext } from "../context.ts";
import { postSlackOpsAlert } from "../../_shared/slack-alerts.ts";
import { IDV_FEE_CHECKOUT_KIND } from "../../_shared/idvFee.ts";

export function isIdvFeeSession(session: Stripe.Checkout.Session): boolean {
  return (session.metadata as Record<string, string> | null)?.kind === IDV_FEE_CHECKOUT_KIND;
}

/**
 * A payment that buys nothing is given back IN FULL (we never keep money for a
 * check that will not run): the payer is already ID-verified (either verdict),
 * or already holds a paid check (two checkouts paid from two devices). A read
 * that fails keeps the payment as a usable credit and pages; a refund that
 * fails pages too. Never throws: the payment itself is already recorded.
 */
async function refundIfSurplus(
  { stripe, supabase, logStep }: Pick<WebhookContext, "stripe" | "supabase" | "logStep">,
  row: { id: string; user_id: string },
  paymentIntentId: string | null,
): Promise<void> {
  const [prof, others] = await Promise.all([
    supabase.from("profiles").select("idv_status, stripe_identity_verified").eq("user_id", row.user_id).maybeSingle(),
    supabase.from("idv_fee_payments").select("id").eq("user_id", row.user_id)
      .in("status", ["paid", "starting", "session_started"]).neq("id", row.id).limit(1),
  ]);
  if (prof.error || others.error) {
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "warning",
      title: "Paid ID check: surplus check could not run",
      message: "Could not read whether this ID-check payment duplicates a verified account or another paid check. It stays a usable credit; check it by hand.",
      fields: { payment_id: row.id, error: String(prof.error?.message ?? others.error?.message).slice(0, 200) },
    });
    return;
  }
  const p = prof.data as { idv_status?: string | null; stripe_identity_verified?: boolean | null } | null;
  const verified = p?.idv_status === "verified" || p?.stripe_identity_verified === true;
  const duplicate = Array.isArray(others.data) && others.data.length > 0;
  if (!verified && !duplicate) return;
  try {
    if (!paymentIntentId) throw new Error("no payment_intent on the session");
    // own-mistake full refund (owner, 2026-10-14): we took a payment for a check they did not need (already verified, or already holding a paid check), so the whole fee goes back.
    const refund = await stripe.refunds.create(
      { payment_intent: paymentIntentId, metadata: { kind: "idv_fee_refund", idv_fee_payment_id: row.id, why: verified ? "already_verified" : "duplicate" } },
      { idempotencyKey: `idv-fee-refund:${row.id}` },
    );
    const { data: done, error: updErr } = await supabase
      .from("idv_fee_payments")
      .update({ status: "refunded", stripe_refund_id: refund.id, updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("status", "paid")
      .select("id");
    if (updErr || !Array.isArray(done) || done.length === 0) {
      await postSlackOpsAlert({
        kind: "stripe_webhook_error",
        severity: "warning",
        title: "ID-check refund not recorded",
        message: "A surplus ID-check payment was refunded in Stripe but idv_fee_payments did not move to refunded. Set it by hand.",
        fields: { payment_id: row.id, stripe_refund_id: refund.id, error: String(updErr?.message ?? "0 rows").slice(0, 200) },
      });
    }
    logStep("idv_fee surplus refunded in full", { paymentId: row.id, verified, duplicate });
  } catch (err) {
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Surplus ID-check payment not refunded",
      message: `A landlord paid for an ID check they cannot use (${verified ? "already verified" : "already holds a paid check"}) and the automatic full refund failed. Refund it by hand.`,
      fields: { payment_id: row.id, payment_intent: paymentIntentId ?? "(none)", error: String((err as Error)?.message ?? err).slice(0, 200) },
    });
  }
}

export async function settleIdvFee(
  session: Stripe.Checkout.Session,
  { stripe, supabase, logStep }: Pick<WebhookContext, "stripe" | "supabase" | "logStep">,
): Promise<void> {
  if (session.payment_status !== "paid") {
    logStep("idv_fee checkout completed unpaid — nothing to settle", { sessionId: session.id, payment_status: session.payment_status });
    return;
  }
  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  const now = new Date().toISOString();

  const { data: moved, error: moveErr } = await supabase
    .from("idv_fee_payments")
    .update({ status: "paid", paid_at: now, stripe_payment_intent_id: paymentIntentId, updated_at: now })
    .eq("stripe_checkout_session_id", session.id)
    .eq("status", "awaiting_payment")
    .select("id, user_id");
  if (moveErr) throw new Error(`idv_fee_payments paid update failed: ${moveErr.message}`);
  if (Array.isArray(moved) && moved.length > 0) {
    logStep("idv_fee paid", { sessionId: session.id, paymentId: moved[0].id });
    await refundIfSurplus({ stripe, supabase, logStep }, moved[0], paymentIntentId);
    return;
  }

  // Nothing moved: a repeat delivery (already paid/used), or the row was never
  // written (stripe-idv-start's insert failed after Stripe made the session).
  const { data: existing, error: readErr } = await supabase
    .from("idv_fee_payments")
    .select("id, status")
    .eq("stripe_checkout_session_id", session.id)
    .maybeSingle();
  if (readErr) throw new Error(`idv_fee_payments read failed: ${readErr.message}`);
  if (existing) {
    logStep("idv_fee already settled (repeat delivery)", { sessionId: session.id, status: existing.status });
    return;
  }

  const userId = (session.metadata as Record<string, string> | null)?.user_id || session.client_reference_id || null;
  if (!userId || !(Number(session.amount_total) > 0)) {
    await postSlackOpsAlert({
      kind: "stripe_webhook_error",
      severity: "critical",
      title: "Paid ID check has no account to credit",
      message: "An ID-check payment completed with no user_id or amount, so no check was unlocked. Refund it or credit the account by hand.",
      fields: { session_id: session.id, amount_total: String(session.amount_total ?? "(unknown)") },
    });
    return;
  }
  const { data: inserted, error: insErr } = await supabase
    .from("idv_fee_payments")
    .insert({
      user_id: userId,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      amount_cents: Number(session.amount_total),
      stripe_livemode: session.livemode === true,
      status: "paid",
      paid_at: now,
    })
    .select("id, user_id");
  // 23505: a concurrent delivery inserted it first, which is the outcome we want.
  if (insErr && (insErr as { code?: string }).code !== "23505") {
    throw new Error(`idv_fee_payments insert failed: ${insErr.message}`);
  }
  logStep("idv_fee paid (row recovered from session metadata)", { sessionId: session.id });
  if (!insErr && Array.isArray(inserted) && inserted[0]) {
    await refundIfSurplus({ stripe, supabase, logStep }, inserted[0], paymentIntentId);
  }
}
