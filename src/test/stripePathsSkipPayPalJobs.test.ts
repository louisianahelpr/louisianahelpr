/**
 * CLASS GUARD (PayPal Plan A, phase 5): no Stripe refund path treats a PayPal-paid job as "nothing
 * was paid".
 *
 * A job paid through PayPal has no stripe_payment_intent_id. Every Stripe-era refund path reads a
 * missing PaymentIntent as "no payment was ever made": void-cancelled-payments Part A would write a
 * cancelled PayPal job off as unpaid (payment_status 'cancelled') with the poster's money still
 * held at PayPal, and nothing would ever hand it back; cancel_escrow would cancel it refunding
 * nothing. So every edge file that calls Stripe's refunds.create is classified, EXACT both ways:
 *   AWARE   asks the PayPal ledger first (paypalJobRefunds.ts readPayPalJobPayment /
 *           payPalFundedJobIds, or create-payment's payPalRefundDoorFor) and steps aside, at the
 *           exact statement named below, BEFORE its first Stripe refund;
 *   EXEMPT  cannot meet a PayPal job, with the reason.
 * refund-request-sweep (no Stripe call of its own, it hands agreements to execute-dispute-split)
 * must route a PayPal job to paypal-refunds.
 *
 * Executed proof of the money side: src/test/pglite/paypalRefundsAndFee.pglite.mjs.
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts | const jobs = paypalJobs.error ? [] : (cancelledJobs ?? []).filter((j: { id: string }) => !paypalJobs.ids.has(j.id)); | const jobs = cancelledJobs ?? [];
 * @mutate supabase/functions/create-payment/index.ts |     if (payPalDoor) return payPalDoor; |     void payPalDoor;
 * @mutate supabase/functions/execute-dispute-split/index.ts |     if (pp.payment) {\n      // An AGREED refund request on a PayPal job | if (false) {\n      // An AGREED refund request on a PayPal job
 * @mutate supabase/functions/refund-request-sweep/index.ts | const settler = pp.payment ? "paypal-refunds" : "execute-dispute-split"; | const settler = "execute-dispute-split";
 * @mutate supabase/functions/_shared/payments/paypalRefundDoors.ts |   if (!found.payment) return null;\n\n  if (action !== "admin_refund_general") { |   if (found.payment) return null;\n\n  if (action !== "admin_refund_general") {
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

/** Each AWARE file: the statement that steps aside for a PayPal job, and what it must come before. */
const AWARE: Record<string, { steps: RegExp; before: RegExp }> = {
  "supabase/functions/create-payment/index.ts": {
    steps: /const payPalDoor = await payPalRefundDoorFor\(supabaseAdmin, user, action, body, corsHeaders\); if \(payPalDoor\) return payPalDoor;/,
    before: /new Stripe\(stripeSecretKeyFor\(stripeMode\)/,
  },
  "supabase/functions/void-cancelled-payments/index.ts": {
    steps: /const paypalJobs = await payPalFundedJobIds\(supabaseAdmin, [^;]*\); if \(paypalJobs\.error\) defects\.record\([^;]*\); const jobs = paypalJobs\.error \? \[\] : \(cancelledJobs \?\? \[\]\)\.filter\(\(j: \{ id: string \}\) => !paypalJobs\.ids\.has\(j\.id\)\);/,
    before: /let voided = 0;/,
  },
  "supabase/functions/execute-dispute-split/index.ts": {
    steps: /const pp = await readPayPalJobPayment\(supabaseAdmin, dispute\.job_id\); if \(pp\.error\) \{[\s\S]*?return json\([^;]*503\); \} if \(pp\.payment\) \{[\s\S]*?return json\(\{ error: "this job was paid with PayPal/,
    before: /refunds\.create\(/,
  },
};

/** Files with a Stripe refund that never meet a PayPal job (reason given). */
// @two-way src/test/stripePathsSkipPayPalJobs.test.ts:expect(found).toEqual([...Object.keys(AWARE), ...Object.keys(EXEMPT)].sort());
const EXEMPT: Record<string, string> = {
  "supabase/functions/process-scheduled-payouts/index.ts": "refunds a crew's unfilled spots from its Stripe charge; payouts are pp-phase4's and crews are not on PayPal (phase 6)",
  "supabase/functions/charge-recurring-visits/index.ts": "repeat visits are charged per visit on Stripe; PayPal visits are phase 6",
  "supabase/functions/stripe-webhook/handlers/settleRecurringVisitCheckout.ts": "a Stripe Checkout event for a repeat visit: always a Stripe charge",
  "supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts": "a Stripe event about a second Stripe charge on one job: always a Stripe charge",
  "supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts": "a Stripe event for the one-time setup fee checkout: always a Stripe charge",
  "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts": "Declutter (paused); its PayPal move is planned per section, not built",
  "supabase/functions/declutter-money/index.ts": "Declutter (paused); its PayPal move is planned per section, not built",
  "supabase/functions/_shared/shopRefunds.ts": "Shops (testers only); its PayPal move is planned per section, not built",
};

function stripeRefundFiles(): string[] {
  return walkSource([FUNCS], [".ts"])
    .map(rel)
    .filter((f) => /\brefunds\.create\(/.test(code(f)))
    .sort();
}

describe("Stripe refund paths step aside for a PayPal-paid job (PayPal phase 5)", () => {
  const found = stripeRefundFiles();

  it("inventory: every edge file with a Stripe refund is AWARE or EXEMPT, exact both ways", () => {
    expect(found.length).toBeGreaterThan(8);
    expect(found).toEqual([...Object.keys(AWARE), ...Object.keys(EXEMPT)].sort());
  });

  for (const [file, rule] of Object.entries(AWARE)) {
    it(`${file} asks the PayPal ledger and steps aside before its first Stripe refund`, () => {
      const src = flat(code(file));
      const at = src.search(rule.steps);
      expect(at, "the step-aside statement").toBeGreaterThan(-1);
      const first = src.search(rule.before);
      expect(first, "the Stripe statement it must precede").toBeGreaterThan(-1);
      expect(at).toBeLessThan(first);
    });
  }

  it("refund-request-sweep sends an agreement on a PayPal job to paypal-refunds", () => {
    const src = flat(code("supabase/functions/refund-request-sweep/index.ts"));
    expect(src).toMatch(/const pp = await readPayPalJobPayment\(admin, row\.job_id\); if \(pp\.error\) \{ defects\.record\([^;]*\); continue; \}/);
    expect(src).toMatch(/const settler = pp\.payment \? "paypal-refunds" : "execute-dispute-split";/);
    expect(src).toMatch(/`\$\{url\}\/functions\/v1\/\$\{settler\}`/);
  });

  it("create-payment's PayPal door covers every refund action and refuses the ones PayPal cannot do yet", () => {
    const doors = flat(code("supabase/functions/_shared/payments/paypalRefundDoors.ts"));
    for (const action of ["admin_refund_general", "cancel_escrow", "cancel_quote", "admin_refund_dispute", "admin_bill_helpr_fault"]) {
      expect(doors).toContain(`"${action}"`);
    }
    // A job with a PayPal payment never falls through to Stripe; a failed read refuses.
    expect(doors).toMatch(/if \(found\.error\) \{ console\.error\([^;]*\); return answer\(503,/);
    expect(doors).toMatch(/if \(!found\.payment\) return null; if \(action !== "admin_refund_general"\) \{ return answer\(409,/);
  });
});
