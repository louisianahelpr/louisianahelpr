/**
 * GUARD (Q1213): a gift card shortfall is never a checkout Stripe refuses.
 *
 * THE BUG (lh-money-escrow review of Q454, 2026-10-03; code read): redeem_gift_card
 * reserved a gift that covered all but 1-49 cents of a job and answered
 * needs_payment, and create-payment opened a Stripe Checkout for exactly that
 * shortfall. Stripe's USD minimum charge is 0.50 (docs.stripe.com/currencies),
 * so the checkout never opened and the gift sat 'reserved' on the job.
 * Fixed by 20261004192253_gift_shortfall_stripe_minimum.sql: the function
 * refuses that redemption BEFORE reserving. PGlite proof (old RED, new GREEN,
 * applied 3x): src/test/pglite/giftShortfallStripeMinimum.pglite.mjs.
 *
 * Reads the NEWEST definition of redeem_gift_card (any dollar tag, comments
 * blanked) and asserts the minimum check exists and sits before the reserve.
 *
 * @mutate supabase/migrations/20261006053059_gift_refuses_while_card_checkout_open.sql | if v_difference_cents > 0 and v_difference_cents < 50 then | if false then
 * @mutate supabase/migrations/20261006053059_gift_refuses_while_card_checkout_open.sql | v_difference_cents > 0 and v_difference_cents < 50 | v_difference_cents > 0 and v_difference_cents < 5
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase", "migrations");
const FN_RE = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?redeem_gift_card\s*\([\s\S]*?\bAS\s+(\$\w*\$)([\s\S]*?)\1/gi;

let newest: { file: string; body: string } | null = null;
let definitions = 0;
const MIGRATION_FILES = readdirSync(MIG).filter((n) => n.endsWith(".sql")).sort();
for (const f of MIGRATION_FILES) {
  const sql = blankSqlComments(readFileSync(join(MIG, f), "utf8"));
  for (const m of sql.matchAll(FN_RE)) {
    definitions++;
    newest = { file: f, body: m[2] };
  }
}

/** Stripe's minimum USD charge, in cents (docs.stripe.com/currencies). */
const STRIPE_MIN_USD_CENTS = 50;

describe("redeem_gift_card never leaves a shortfall under Stripe's minimum (Q1213)", () => {
  it("finds the function's definitions in the migrations", () => {
    // 955 migration files on 2026-10-04.
    expect(MIGRATION_FILES.length).toBeGreaterThan(900);
    expect(definitions).toBeGreaterThan(1);
    expect(newest).not.toBeNull();
  });

  it("the newest definition refuses a 1-49 cent shortfall, before the gift is reserved", () => {
    const body = newest!.body;
    const check = /if\s+v_difference_cents\s*>\s*0\s+and\s+v_difference_cents\s*<\s*(\d+)\s+then\s+raise\s+exception/i.exec(body);
    expect(check, `${newest!.file}: no shortfall minimum check`).not.toBeNull();
    expect(Number(check![1])).toBe(STRIPE_MIN_USD_CENTS);
    const reserve = body.search(/set\s+status\s*=\s*'reserved'/i);
    expect(reserve).toBeGreaterThan(0);
    expect(check!.index).toBeLessThan(reserve);
  });
});
