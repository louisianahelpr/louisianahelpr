#!/usr/bin/env node
/**
 * PayPal phase 6 SANDBOX journey: the lead runs this on the owner's Mac (the sandbox keys live
 * there; cloud sessions cannot reach PayPal). It drives the REAL phase 6 modules against the
 * PayPal SANDBOX, never live (PayPalClient refuses live keys: PAYPAL_LIVE_ALLOWED = false), and
 * touches no database.
 *
 *   PAYPAL_ENV=sandbox PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... \
 *     node --experimental-transform-types scripts/paypal-phase6-sandbox-journey.mjs
 *
 * What it proves, each step printed and saved to ~/.lh-shots/pp-phase6/journey-<stamp>.json:
 *   1. A card checkout that saves the card (store_in_vault ON_SUCCESS, test card 4111...)
 *      returns a vault id with vaultSource "card" (captureFromOrder).
 *   2. Every cancellation tier on a $100.00 capture: PayPal's real fee is read back from the
 *      capture (createCaptureFeeReader), planPayPalCancellation prices the tier, and the adapter's
 *      partial refund returns EXACTLY plan.refundCents; replaying the same key returns the same
 *      refund (no second refund); PayPal shows the capture partially refunded by that amount;
 *      refund + Helpr share + platform share + PayPal fee = the capture, to the cent.
 *   3. A merchant-initiated charge of the saved card (chargeSaved, the auto-tip / repeat-visit
 *      path) captures with nobody present; the same key again replays the same order.
 *   4. A refund past what is left is refused by PayPal (REFUND_AMOUNT_EXCEEDED), not sent.
 * Exit 1 on any mismatch. Fail closed: no keys, or PAYPAL_ENV other than "sandbox", stops it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import { PayPalClient } from "../supabase/functions/_shared/payments/paypalClient.ts";
import { captureFromOrder, createCaptureFeeReader, createPayPalCheckoutProvider } from "../supabase/functions/_shared/payments/paypalCheckout.ts";
import { planPayPalCancellation } from "../supabase/functions/_shared/payments/paypalCancellation.ts";
import { paypalTipChargeBreakdown } from "../supabase/functions/_shared/tipFees.ts";

if (process.env.PAYPAL_ENV !== "sandbox") {
  console.error("PAYPAL_ENV must be exactly 'sandbox' for this journey. Nothing was sent.");
  process.exit(1);
}
if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
  console.error("PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox) are required. Nothing was sent.");
  process.exit(1);
}
const client = new PayPalClient({ env: "sandbox", clientId: process.env.PAYPAL_CLIENT_ID, clientSecret: process.env.PAYPAL_CLIENT_SECRET });
const provider = createPayPalCheckoutProvider(client);
const readFee = createCaptureFeeReader(client);
const run = `j6-${Date.now().toString(36)}`;
const out = { run, steps: [], ok: true };
const step = (name, data, pass) => {
  out.steps.push({ name, pass, ...data });
  if (!pass) out.ok = false;
  console.log(`${pass ? "ok  " : "FAIL"} ${name} ${JSON.stringify(data)}`);
};

/** A $X card order captured at once (the shape MEASURED #01 / #11 used). */
async function cardOrder(cents, ref, vault) {
  const order = await client.request("POST", "/v2/checkout/orders", {
    idempotencyKey: `lh:journey:${run}:${ref}:amt${cents}`,
    prefer: "return=representation",
    body: {
      intent: "CAPTURE",
      purchase_units: [{ reference_id: ref, custom_id: ref, amount: { currency_code: "USD", value: (cents / 100).toFixed(2) } }],
      payment_source: {
        card: {
          name: "Test Poster", number: "4111111111111111", expiry: "2030-12", security_code: "123",
          ...(vault ? { attributes: { vault: { store_in_vault: "ON_SUCCESS" } } } : {}),
        },
      },
    },
  });
  return captureFromOrder(order);
}

// 1. Save a card.
const saved = await cardOrder(4000, "save-card", true);
step("1. checkout saved the card", { orderId: saved.providerOrderId, vaultId: saved.vaultId, vaultSource: saved.vaultSource }, !!saved.vaultId && saved.vaultSource === "card");

// 2. Every cancellation tier on $100.00.
const START = Date.parse("2026-11-11T00:00:00Z"); // 2026-11-10 18:00 Central
const job = (hoursBefore) => ({
  id: "00000000-0000-4000-8000-000000000000", customer_id: null, budget: 100, date_needed: "2026-11-10", start_time: "18:00:00",
  cancelled_at: new Date(START - hoursBefore * 3600_000).toISOString(), helper_id: "h", helper_confirmed_at: "2026-11-01T00:00:00Z",
  helper_fee_flat_cents: 70, helper_fee_percent: 8, customer_fee_amount: 0, poster_fee_flat_cents: null, onboarding_fee_amount: 0,
  sales_tax_amount: 0, is_group_job: false, parent_job_id: null, recurrence_days: null, series_ban_cancelled_at: null,
});
for (const [tier, hours] of [["0%", 48], ["25%", 10], ["50%", 1]]) {
  const cap = await cardOrder(10000, `tier-${tier.replace("%", "")}`, false);
  const fee = await readFee(cap.providerCaptureId);
  const plan = planPayPalCancellation({ job: job(hours), sellerFault: false, capturedCents: cap.amountCents, providerFeeCents: fee ?? -1, alreadyRefundedCents: 0 });
  if (plan.kind !== "plan") { step(`2. ${tier} plan`, { plan }, false); continue; }
  const key = `lh:refund:${run}-${tier.replace("%", "")}`;
  const r1 = await provider.refund({ idempotencyKey: key, providerCaptureId: cap.providerCaptureId, amountCents: plan.refundCents, note: "phase 6 sandbox journey" });
  const r2 = await provider.refund({ idempotencyKey: key, providerCaptureId: cap.providerCaptureId, amountCents: plan.refundCents, note: "phase 6 sandbox journey" });
  const after = await client.request("GET", `/v2/payments/captures/${cap.providerCaptureId}`);
  const sums = plan.refundCents + plan.helprPayoutCents + plan.platformKeepsOfFeeCents + plan.providerFeeKeptCents;
  step(`2. ${tier}: refund exactly the poster's share; replay is the same refund`, {
    capture: cap.providerCaptureId, paypalFeeCents: fee, feeCents: plan.feeCents, refundCents: plan.refundCents,
    helprPayoutCents: plan.helprPayoutCents, platformKeepsOfFeeCents: plan.platformKeepsOfFeeCents,
    refund1: [r1.providerRefundId, r1.amountCents, r1.status], refund2: [r2.providerRefundId, r2.amountCents], captureStatusAfter: after?.status,
    sumsToCapture: sums === cap.amountCents,
  }, r1.amountCents === plan.refundCents && r2.providerRefundId === r1.providerRefundId && sums === cap.amountCents && fee !== null
    && after?.status === "PARTIALLY_REFUNDED");
  if (tier === "50%") {
    // 4. Past what is left: refused, not sent. (One cent past the remainder. MEASURED 2026-10-23:
    // asking for EXACTLY the whole capture after a partial refund is NOT refused: PayPal refunds
    // the remainder and answers with that smaller amount, which the settlement flags as
    // refund_amount_mismatch. The database never lets us ask past what is left.)
    const left = cap.amountCents - plan.refundCents;
    try {
      await provider.refund({ idempotencyKey: `${key}-over`, providerCaptureId: cap.providerCaptureId, amountCents: left + 1, note: "over" });
      step("4. over-refund refused", { asked: left + 1 }, false);
    } catch (e) {
      step("4. over-refund refused", { asked: left + 1, issue: e.issue ?? null, http: e.httpStatus ?? null }, e.issue === "REFUND_AMOUNT_EXCEEDED");
    }
  }
}

// 3. Merchant-initiated charge of the saved card ($5 tip + its fee, the auto-tip shape).
if (saved.vaultId) {
  const q = paypalTipChargeBreakdown(500);
  const key = `lh:pp:tip:${run}:amt${q.chargeCents}:a1`;
  const c1 = await provider.chargeSaved({ idempotencyKey: key, referenceId: `${run}-tip`, vaultId: saved.vaultId, amountCents: q.chargeCents, vaultSource: "card" });
  const c2 = await provider.chargeSaved({ idempotencyKey: key, referenceId: `${run}-tip`, vaultId: saved.vaultId, amountCents: q.chargeCents, vaultSource: "card" });
  step("3. saved card charged with nobody present; the same key replays the same order", {
    chargeCents: q.chargeCents, order1: c1.providerOrderId, order2: c2.providerOrderId, status: c1.status, captured: c1.amountCents,
  }, c1.settled && c1.amountCents === q.chargeCents && c2.providerOrderId === c1.providerOrderId);
}

const dir = `${os.homedir()}/.lh-shots/pp-phase6`;
mkdirSync(dir, { recursive: true });
const file = `${dir}/journey-${run}.json`;
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`${out.ok ? "ALL OK" : "FAILED"}: saved to ${file}`);
process.exit(out.ok ? 0 : 1);
