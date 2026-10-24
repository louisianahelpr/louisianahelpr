/**
 * CLASS GUARD (PayPal Plan A, phase 5): every PayPal refund is claimed in the ledger BEFORE PayPal
 * is asked, so no retry, timeout or second tab can refund twice, and none can skip the database's
 * refusals (no refund once a payout is queued, held or sent; never more than the payment).
 *
 * (a) PaymentProvider.refund is called in ONE place: refundProviderPayment
 *     (_shared/payments/providerRefunds.ts). No other edge file calls `.refund({` on a provider or
 *     names PayPal's capture-refund path (only the adapter, paypalCheckout.ts, builds it).
 * (b) Inside refundProviderPayment the order is claim (paypal_refund_claim) -> PayPal ->
 *     record (paypal_refund_record), and PayPal is asked with the claim's own key.
 * (c) Every refund door goes through it: the cancelled-job sweep, the lost-answer retry, the admin
 *     refund and the agreed refund request (inventory floor).
 *
 * Executed proof: src/test/pglite/paypalRefundsAndFee.pglite.mjs (claim/record/reconcile SQL, 3x)
 * and the sandbox journey (~/.lh-shots/paypal-p5/journey-*.json).
 *
 * @mutate supabase/functions/_shared/payments/providerRefunds.ts | const claimed = await db.rpc("paypal_refund_claim", { | const claimed = await db.rpc("paypal_refund_peek", {
 * @mutate supabase/functions/_shared/payments/providerRefunds.ts | paid = await provider.refund({ idempotencyKey: req.idempotencyKey, | paid = await provider.refund({ idempotencyKey: `${req.idempotencyKey}:${Date.now()}`,
 * @mutate supabase/functions/_shared/payments/paypalJobRefunds.ts |   const out = await refundProviderPayment(deps.db, deps.provider, {\n    paymentId: row.provider_payment_id,\n    idempotencyKey: key, |   const out = await deps.provider.refund({\n    providerCaptureId: row.provider_payment_id,\n    idempotencyKey: key,
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const FUNCS = path.join(ROOT, "supabase", "functions");
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const code = (f: string) => blankComments(readFileSync(path.join(ROOT, f), "utf8"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const ENGINE = "supabase/functions/_shared/payments/providerRefunds.ts";
const ADAPTER = "supabase/functions/_shared/payments/paypalCheckout.ts";

const files = () => walkSource([FUNCS], [".ts"]).map(rel).sort();

describe("PayPal refunds are claimed before PayPal is asked (PayPal phase 5)", () => {
  it("(a) only the engine asks a provider for a refund; only the adapter builds PayPal's refund path", () => {
    const callers: string[] = [];
    const pathBuilders: string[] = [];
    for (const f of files()) {
      const src = flat(code(f));
      // A provider refund call: `<x>.refund({` with an idempotency key or a capture id (Stripe's is
      // `refunds.create`, which this never matches).
      if (/\.refund\(\{[^}]*(idempotencyKey|providerCaptureId)/.test(src)) callers.push(f);
      if (/\/v2\/payments\/captures\/[^`"']*\/refund/.test(src)) pathBuilders.push(f);
    }
    expect(callers).toEqual([ENGINE]);
    expect(pathBuilders).toEqual([ADAPTER]);
  });

  it("(b) the engine claims, then asks PayPal with the claim's key, then records PayPal's answer", () => {
    const src = flat(code(ENGINE));
    const claim = src.indexOf('db.rpc("paypal_refund_claim", {');
    const ask = src.indexOf("paid = await provider.refund({ idempotencyKey: req.idempotencyKey, providerCaptureId: claim.capture_id,");
    const record = src.indexOf('db.rpc("paypal_refund_record", { p_refund_id: claim.refund_id, p_provider_refund_id: paid.providerRefundId,');
    expect(claim).toBeGreaterThan(-1);
    expect(ask).toBeGreaterThan(claim);
    expect(record).toBeGreaterThan(ask);
    // The claim's key is the one PayPal sees, and the database's refusals come back as refusals.
    expect(src).toContain("p_idempotency_key: req.idempotencyKey,");
    for (const code of ["refund_after_payout_queued", "refund_exceeds_refundable", "refund_exceeds_payment", "refund_needs_captured_payment", "refund_key_reused", "refund_env_mismatch", "orphan_refund_must_be_full"]) {
      expect(src).toMatch(new RegExp(`const GUARD_CODES: RefundRefusal\\[\\] = \\[[^\\]]*"${code}"`));
    }
    // The environment and the refundable ceiling go into the claim, so a refusal leaves no row.
    expect(src).toContain("p_env: provider.env,");
    expect(src).toContain("p_max_total_cents: req.maxTotalCents ?? null,");
  });

  it("(c) every refund door goes through the engine, each under its business-event key", () => {
    const doors = flat(code("supabase/functions/_shared/payments/paypalJobRefunds.ts"));
    const uses = doors.match(/await refundProviderPayment\(deps\.db, deps\.provider, \{/g) ?? [];
    // lost-answer retry, admin refund, agreed refund request, orphan capture (a cancelled job is
    // refunded by phase 6's sweep through this same engine, under cancelRefundKey)
    expect(uses.length).toBeGreaterThan(3);
    expect(doors).toContain("export const cancelRefundKey = (jobId: string, earlierAttempts = 0) =>");
    for (const key of [
      "idempotencyKey: row.idempotency_key,",
      "const key = `lh:job:${j.id}:refund:admin:${input.requestId.toLowerCase()}`;",
      "const key = `lh:dispute:${disputeId}:refund`;",
      "const key = `lh:pp:${row.provider_payment_id}:refund:orphan${tries > 0 ? `:a${tries + 1}` : \"\"}`;",
    ]) {
      expect(doors).toContain(key);
    }
    // Every fresh door claim carries the refundable ceiling (PayPal keeps its fee), checked under the lock.
    expect((doors.match(/maxTotalCents: /g) ?? []).length).toBeGreaterThan(2);
  });
});
