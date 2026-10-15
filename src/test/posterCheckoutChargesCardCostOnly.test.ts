/**
 * CLASS GUARD: every poster checkout charges Stripe's card cost and nothing
 * more (owner pop-up, 2026-10-11: "remove the service fee for posters bc right
 * now I'm worried no one will post when they can easily post for free on
 * Facebook"; answers: the poster still pays Stripe's real card cost, new
 * checkouts only, the Helpr commission is unchanged).
 *
 * Before this, the poster's service fee was their tier percent of the budget
 * (12 / 11 / 10 / 9 / 8, the Helpr commission ladder), floored at Stripe's
 * cost. The class is "a poster checkout path that prices a tier percent", and
 * this file builds its inventory from the app's own source:
 *
 *   1. Every Stripe charge-creation call in supabase/functions (Checkout
 *      Sessions, PaymentIntents, subscriptions, invoices, charges) is found by
 *      scanning the code, and must be classified below, EXACTLY: a new charge
 *      site, or one that disappears, fails here until it is classified.
 *   2. Each POSTER-JOB charge site's file must price the fee with
 *      `posterCardCostFeeCents` and must not read a tier (no
 *      `subscription_tier` read, no tier resolver call), and its behavioural
 *      edge test (which runs the real function for every tier) must exist.
 *   3. The retired tier-fee APIs (`posterFeePercentForTier`,
 *      `posterServiceFeeCents`) are gone from every source file.
 *
 * Roadmap F3 (owner 2026-10-14/15) went one step further for every job funded
 * from 2026-10-15: NO fee at all for the poster (the Helpr pays 5% + 70c).
 * So create-payment's own checkouts price no poster fee and must not call
 * posterCardCostFeeCents; the card-cost fee survives only for a recurring
 * series funded before the change (charge-recurring-visits, behind the
 * series' fee-model stamp), and still never a tier.
 *
 * The behavioural proof lives in the edge suites named in POSTER_JOB_SITES;
 * this file is the inventory that makes sure no path is left out of them.
 * The old-job refund case (a job charged the old tier fee keeps it at refund,
 * read from jobs.customer_fee_amount, never recomputed) is pinned in
 * src/test/edge/create-payment.test.ts, "a job charged before 2026-10-11 ...".
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { walkSource } from "@/test/helpers/walkSource";

const ROOT = resolve(__dirname, "../..");
const FUNCTIONS = resolve(ROOT, "supabase/functions");

/** A call that creates a Stripe charge (or the session/intent that will). */
const CHARGE_SITE = /\.(?:checkout\.sessions|paymentIntents|subscriptions|invoices|invoiceItems|charges)\.create\s*\(/g;

/**
 * Poster-job checkouts: the charges that fund a job a poster posted. Each is
 * priced by `posterCardCostFeeCents` (card cost only), and each names the edge
 * test that proves it for every tier.
 */
const POSTER_JOB_SITES: Record<string, { sites: number; what: string; proof: { file: string; title: string }[] }> = {
  "create-payment/index.ts": {
    // escrow (the job's checkout), escrow's gift-card shortfall session (no
    // service fee: a gift-funded job carries none, only the urgent bonus card
    // fee), and recurring_visit (charges the fee_cents charge-recurring-visits
    // parked, priced there). The fourth site in this file is the TIP, below.
    sites: 3,
    what: "escrow checkout, gift-card shortfall checkout, on-session recurring visit",
    proof: [
      { file: "src/test/edge/create-payment.test.ts", title: "poster checkout charges the job price only, on every tier (F3, owner 2026-10-14/15)" },
      { file: "src/test/edge/create-payment.test.ts", title: "Q362: a non-urgent gift shortfall has no card fee line and stamps a zero fee (clearing any stale one)" },
    ],
  },
  "charge-recurring-visits/index.ts": {
    sites: 1,
    what: "off-session recurring visit charge (and the on-session row it parks)",
    proof: [
      { file: "src/test/edge/charge-recurring-visits.test.ts", title: "a recurring visit charges the poster the card cost only, on every tier (owner, 2026-10-11)" },
    ],
  },
};

/** Charges that are not a poster funding a job, each with why. */
const NOT_A_JOB_CHECKOUT: Record<string, { sites: number; why: string }> = {
  "create-payment/index.ts": { sites: 1, why: "the tip: 100% to the Helpr, the card fee on top (tipFees.ts), no service fee" },
  "auto-tip-charge/index.ts": { sites: 1, why: "the auto-tip: same tip pricing as above, off-session" },
  "create-bgc-payment/index.ts": { sites: 1, why: "a background-check purchase at a fixed price" },
  "create-boost-payment/index.ts": { sites: 1, why: "a Job Boost purchase at a fixed price" },
  "declutter-card/index.ts": { sites: 1, why: "Declutter: a SETUP page that saves a card and charges nothing (row 36)" },
  "declutter-checkout/index.ts": { sites: 1, why: "Declutter: an item sale (items + the 5% + 70c buyer's fee, F1), not a job; the card fee comes out of the fee" },
  "create-pro-checkout/index.ts": { sites: 1, why: "a membership purchase (Stripe Price ids)" },
  "pay-onboarding-fee/index.ts": { sites: 1, why: "the one-time account setup fee, on its own" },
  "create-gift-card-checkout/index.ts": { sites: 1, why: "a gift card purchase: face value + the same card-cost fee (posterCardCostFeeCents), no percentage" },
};

function chargeSitesByFile(): Map<string, number> {
  const out = new Map<string, number>();
  for (const abs of walkSource([FUNCTIONS], [".ts"])) {
    const rel = relative(FUNCTIONS, abs).split("\\").join("/");
    const code = blankComments(readFileSync(abs, "utf8"));
    const n = [...code.matchAll(CHARGE_SITE)].length;
    if (n > 0) out.set(rel, n);
  }
  return out;
}

// @mutate supabase/functions/charge-recurring-visits/index.ts | isFlatFeeJob(parent) ? 0 : posterCardCostFeeCents(budgetCents, taxCents) | posterCardCostFeeCents(budgetCents, taxCents)
describe("every poster checkout charges the card cost only (owner, 2026-10-11)", () => {
  const measured = chargeSitesByFile();

  it("the charge-site inventory is the app's own, and every site is classified, exactly", () => {
    const total = [...measured.values()].reduce((a, b) => a + b, 0);
    // FLOOR: a scan that silently found nothing would pass every loop below.
    expect(total, "no Stripe charge site found in supabase/functions").toBeGreaterThan(8);
    const expected = new Map<string, number>();
    for (const [f, v] of Object.entries(POSTER_JOB_SITES)) expected.set(f, (expected.get(f) ?? 0) + v.sites);
    for (const [f, v] of Object.entries(NOT_A_JOB_CHECKOUT)) expected.set(f, (expected.get(f) ?? 0) + v.sites);
    // Both directions: a new unclassified site fails, and so does a stale entry.
    expect(Object.fromEntries([...measured].sort()), "classify every Stripe charge site (poster-job or not, with why)").toEqual(
      Object.fromEntries([...expected].sort()),
    );
  });

  it("each poster-job checkout prices no poster fee (F3) or, for a pre-F3 series only, the card cost; and reads no tier", () => {
    const cp = blankComments(readFileSync(resolve(FUNCTIONS, "create-payment/index.ts"), "utf8"));
    expect(cp, "create-payment prices a poster card-cost fee again (F3: the poster pays the job price)").not.toMatch(/\bposterCardCostFeeCents\s*\(/);
    expect(cp).toMatch(/const customerFeeAmount = 0;/);
    const crv = blankComments(readFileSync(resolve(FUNCTIONS, "charge-recurring-visits/index.ts"), "utf8"));
    // Exactly one fee site, and it is behind the series' fee-model stamp.
    expect([...crv.matchAll(/\bposterCardCostFeeCents\s*\(/g)].length).toBe(1);
    expect(crv).toMatch(/isFlatFeeJob\(parent\)\s*\?\s*0\s*:\s*posterCardCostFeeCents\(/);
    for (const file of Object.keys(POSTER_JOB_SITES)) {
      const code = blankComments(readFileSync(resolve(FUNCTIONS, file), "utf8"));
      expect(code, `${file} reads the poster's subscription tier at checkout again`).not.toMatch(/subscription_tier/);
      expect(code, `${file} calls a tier-percent resolver`).not.toMatch(/\b(?:feePercentForTier|tierFeePercent|posterFeePercentForTier)\s*\(|TIER_FEE_PERCENT\s*\[/);
    }
  });

  it("each poster-job checkout has its behavioural every-tier proof", () => {
    let proofs = 0;
    for (const [file, { proof }] of Object.entries(POSTER_JOB_SITES)) {
      expect(proof.length, `${file} names no proof`).toBeGreaterThan(0);
      for (const p of proof) {
        const test = readFileSync(resolve(ROOT, p.file), "utf8");
        expect(test.includes(JSON.stringify(p.title)), `${file}: missing proof "${p.title}" in ${p.file}`).toBe(true);
        proofs++;
      }
    }
    expect(proofs).toBeGreaterThanOrEqual(3);
  });

  it("the retired tier-fee APIs are gone from every source file", () => {
    const files = walkSource([resolve(ROOT, "src"), FUNCTIONS, resolve(ROOT, "e2e")], [".ts", ".tsx"]).filter(
      (f) => !/\.test\.tsx?$/.test(f),
    );
    expect(files.length).toBeGreaterThan(500);
    for (const abs of files) {
      const code = blankComments(readFileSync(abs, "utf8"));
      expect(code, relative(ROOT, abs)).not.toMatch(/\bposterFeePercentForTier\b|\bposterServiceFeeCents\b/);
    }
  });
});

// The class, planted back: escrow prices the poster's tier percent again.
// @mutate supabase/functions/create-payment/index.ts |         .select("onboarding_fee_paid")\n        .eq("user_id", user.id) |         .select("onboarding_fee_paid, subscription_tier")\n        .eq("user_id", user.id)
// A recurring visit reads the poster's tier again.
// @mutate supabase/functions/charge-recurring-visits/index.ts |           .select("email") |           .select("email, subscription_tier")
