import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
// The shared listing (Q1142): supabase/functions is outside src/, so it passes
// through to the real readdirSync.
import { readdirSync } from "./helpers/trackedFiles";

/**
 * Q1878: NOTHING CANCELS A JOB'S PAYMENTINTENT BEHIND THE POSTER'S BACK.
 *
 * stripe-webhook has no payment_intent.canceled handler. That is safe only
 * while a job's PaymentIntent reaches `canceled` in exactly two ways:
 *   - create-payment, re-minting a checkout whose 3D Secure challenge was
 *     abandoned: the poster is in the app, tapping "Finish paying", and gets
 *     the new checkout;
 *   - void-cancelled-payments, releasing the hold of a job that is already
 *     cancelled (it tells the poster, Q1714).
 * Stripe's own ACH failures (debit returned, microdeposit timeout or too many
 * attempts) move the PaymentIntent to requires_payment_method and send
 * payment_intent.payment_failed, which paymentIntentPaymentFailed handles
 * (Stripe docs, ACH Direct Debit "PaymentIntent events" and microdeposit
 * error table, read 2026-10-17). A PaymentIntent canceled by a person in the
 * Stripe Dashboard is the remaining case and is not app behaviour.
 *
 * So every `paymentIntents.cancel(` call under supabase/functions (comments
 * blanked) must be one of the sites below, exactly. A new one fails here: give
 * it a reason, or add the payment_intent.canceled handler Q1878 described.
 *
 * @mutate supabase/functions/create-payment/index.ts |               await stripe.paymentIntents.cancel(priorPi.id); |               await stripe.paymentIntents.cancel(priorPi.id); await stripe.paymentIntents.cancel(priorPi.id);
 */

const FN_ROOT = resolve(__dirname, "../../supabase/functions");

// @two-way src/test/paymentIntentCancelSites.test.ts:no longer cancels a PaymentIntent; drop it
const KNOWN_CANCEL_SITES: Record<string, { count: number; reason: string }> = {
  "create-payment/index.ts": { count: 1, reason: "abandoned 3D Secure challenge, cancelled while the poster re-mints the checkout in the app" },
  "void-cancelled-payments/index.ts": { count: 1, reason: "releases the uncaptured hold of a job that is already cancelled, and tells the poster" },
};

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("Q1878: every PaymentIntent cancel site is known", () => {
  const counts = new Map<string, number>();
  for (const file of tsFiles(FN_ROOT)) {
    const code = blankComments(readFileSync(file, "utf8"));
    const n = [...code.matchAll(/\.paymentIntents\.cancel\s*\(/g)].length;
    if (n > 0) counts.set(file.slice(FN_ROOT.length + 1), n);
  }

  it("the scan sees the edge functions", () => {
    expect(existsSync(join(FN_ROOT, "stripe-webhook/index.ts"))).toBe(true);
    expect(counts.size).toBeGreaterThan(0);
  });

  it("each cancel call is one of the known sites, and each known site still cancels exactly as listed", () => {
    const wrong: string[] = [];
    for (const [file, n] of counts) {
      const known = KNOWN_CANCEL_SITES[file];
      if (!known) wrong.push(`${file}: ${n} new paymentIntents.cancel call(s); say why the poster is told, or handle payment_intent.canceled (Q1878)`);
      else if (known.count !== n) wrong.push(`${file}: ${n} cancel call(s), listed ${known.count}`);
    }
    for (const file of Object.keys(KNOWN_CANCEL_SITES)) {
      if (!counts.has(file)) wrong.push(`${file}: no longer cancels a PaymentIntent; drop it`);
    }
    expect(wrong).toEqual([]);
  });

  it("the webhook still has no payment_intent.canceled handler (add one, then drop this check)", () => {
    const hook = blankComments(readFileSync(join(FN_ROOT, "stripe-webhook/index.ts"), "utf8"));
    expect(hook).toContain('"payment_intent.payment_failed"');
    expect(hook).not.toContain('"payment_intent.canceled"');
  });
});
