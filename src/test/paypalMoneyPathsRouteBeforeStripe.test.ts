/**
 * CLASS GUARD (PayPal phase 6): money already taken through PayPal is never handed to a Stripe
 * code path, and the PayPal cancellation never re-types today's money rules.
 *
 * (a) MERCHANT-INITIATED CHARGES. Every edge function that charges a saved Stripe card with
 *     nobody present (`off_session: true`, inventory read from source) asks whether the job was
 *     paid through PayPal (`paypalFundedJob(`) BEFORE that charge. A new off-session charger
 *     without the PayPal question fails here.
 * (b) THE CANCEL SWEEP. void-cancelled-payments routes a PayPal-paid job (`paypalJobs?.has(`)
 *     before its loop's first Stripe client for a refund, and fails closed on an unreadable
 *     PayPal ledger. Without it a PayPal job reads "no PaymentIntent" there and is flipped out
 *     of escrow with the poster's money still held.
 * (c) ONE SET OF RULES. The PayPal cancellation prices the fee with the shared ladder and splits
 *     with the shared split (computeCancellationFee, posterCancelSplit, helprFlatFeeCents,
 *     roundPayoutDownCents) and writes no tier of its own (no 25/50/24-hour literal).
 *
 * @mutate supabase/functions/auto-tip-charge/index.ts | const paypalJob = await paypalFundedJob(supabase, jobId); | const paypalJob = false as boolean \| Error;
 * @mutate supabase/functions/charge-recurring-visits/index.ts | paypalSeries ??= await paypalFundedJob(supabase, String(parent.id)); | paypalSeries ??= false;
 * @mutate supabase/functions/void-cancelled-payments/index.ts | if (paypalJobs?.has(job.id)) { | if (job.never_paypal) {
 * @mutate supabase/functions/_shared/payments/paypalCancellation.ts | const feeDollars = i.sellerFault \|\| refundsSeriesVisitInFull(job) ? 0 : computeCancellationFee(job); | const feeDollars = i.sellerFault ? 0 : Number(job.budget) * 0.25;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { walkSource } from "./helpers/walkSource";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = path.resolve(__dirname, "../..");
const FUNCTIONS = path.join(ROOT, "supabase", "functions");
const code = (f: string) => blankComments(readFileSync(f, "utf8"));
const rel = (f: string) => path.relative(ROOT, f);

describe("PayPal-paid money never reaches a Stripe path (phase 6)", () => {
  const files = walkSource([FUNCTIONS]).filter((f) => f.endsWith(".ts") && !f.includes(`${path.sep}_shared${path.sep}`));

  it("(a) every off-session (merchant-initiated) charger asks about PayPal before it charges", () => {
    const chargers = files.filter((f) => /off_session:\s*true/.test(code(f)));
    expect(chargers.length).toBeGreaterThanOrEqual(2);
    const unrouted = chargers.filter((f) => {
      const src = code(f);
      const ask = src.indexOf("paypalFundedJob(");
      return ask < 0 || ask > src.search(/off_session:\s*true/);
    }).map(rel);
    expect(unrouted).toEqual([]);
  });

  it("(b) the cancel sweep routes PayPal jobs before its first refund client, and fails closed", () => {
    const src = code(path.join(FUNCTIONS, "void-cancelled-payments", "index.ts"));
    const loop = src.indexOf("for (const job of [...(jobs || []), ...crewRetryJobs, ...feeRetryJobs]");
    expect(loop).toBeGreaterThan(0);
    const route = src.indexOf("if (paypalJobs?.has(job.id)) {", loop);
    const failClosed = src.indexOf("if (paypalJobs === null && !job.stripe_payment_intent_id && !job.stripe_session_id) {", loop);
    const firstStripe = src.indexOf('stripes.clientForJob(job.id, "refund")', loop);
    expect(route).toBeGreaterThan(loop);
    expect(failClosed).toBeGreaterThan(loop);
    expect(firstStripe).toBeGreaterThan(route);
    expect(firstStripe).toBeGreaterThan(failClosed);
    // The routed branch ends the iteration (never falls through to Stripe).
    expect(src.slice(route, firstStripe)).toMatch(/continue;\s*\}\s*\}/);
  });

  it("(c) the PayPal cancellation uses today's rules by import, and types no tier of its own", () => {
    const src = code(path.join(FUNCTIONS, "_shared", "payments", "paypalCancellation.ts"));
    for (const fn of ["computeCancellationFee(", "posterCancelSplit(", "helprFlatFeeCents(", "roundPayoutDownCents(", "refundsSeriesVisitInFull("]) {
      expect(src).toContain(fn);
    }
    const literals = [...src.matchAll(/(?<![\w.])(25|50|24|0\.25|0\.5)(?![\w.])/g)].map((m) => m[0]);
    expect(literals).toEqual([]);
  });
});
