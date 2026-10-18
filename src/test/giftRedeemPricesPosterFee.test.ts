/**
 * Gift first on the jobs poster fee: the NEWEST redeem_gift_card prices the
 * poster's fee into what the gift pays (owner 2026-10-18, Q2082 slice 3b;
 * 20261018031451_poster_fee_gift_first.sql).
 *
 * The edge tests mock redeem_gift_card, and the PGlite proof
 * (src/test/pglite/posterFeeGiftFirst.pglite.mjs) runs in no workflow, so this
 * pins the definition the database will hold (any dollar tag, comments
 * blanked): the cost adds v_fee_cents; on a poster-fee job a missing fee stamp
 * raises P0001 BEFORE the gift is reserved or consumed; both outcomes return
 * fee_cents, which create-payment checks (lh-money-escrow review of
 * gift-first, #2 and #3). Without the fee in the cost, the gift would pay no fee
 * while the settle still stamped one, and every refund path would hold back a
 * fee that was never charged.
 *
 * @mutate supabase/migrations/20261018031451_poster_fee_gift_first.sql | coalesce(v_job.urgent_fee, 0)) * 100)::int + v_fee_cents; | coalesce(v_job.urgent_fee, 0)) * 100)::int;
 * @mutate supabase/migrations/20261018031451_poster_fee_gift_first.sql |     if v_fee_cents <= 0 then |     if false then
 * @mutate supabase/migrations/20261018031451_poster_fee_gift_first.sql |       'fee_cents',        v_fee_cents | 'fee_cents_x', v_fee_cents
 * @mutate supabase/migrations/20261018031451_poster_fee_gift_first.sql |     v_fee_cents := round(coalesce(v_job.customer_fee_amount, 0) * 100)::int; |     v_fee_cents := 0;
 */
import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const redeem = effectiveDefs(join(ROOT, "supabase", "migrations")).get("redeem_gift_card");
const body = blankSqlComments(redeem?.stmt ?? "");

describe("the newest redeem_gift_card prices the poster fee (gift first)", () => {
  it("is found, and is the gift-first definition or a later one", () => {
    expect(redeem, "no redeem_gift_card definition in the migrations").toBeDefined();
    expect(body.length).toBeGreaterThan(2000);
    expect(body).toMatch(/\bv_fee_cents\b/);
  });

  it("the cost the gift is applied against adds the fee", () => {
    expect(body).toMatch(/v_cost_cents\s*:=\s*round\(\(v_job\.budget\s*\+\s*coalesce\(v_job\.urgent_fee,\s*0\)\)\s*\*\s*100\)::int\s*\+\s*v_fee_cents\s*;/i);
  });

  it("the fee is the stamped customer_fee_amount on a poster-fee job, and 0 on the flat model", () => {
    expect(body).toMatch(/if\s+v_job\.poster_fee_flat_cents\s+is\s+not\s+null\s+then\s+v_fee_cents\s*:=\s*round\(coalesce\(v_job\.customer_fee_amount,\s*0\)\s*\*\s*100\)::int\s*;/i);
    expect(body).toMatch(/else\s+v_fee_cents\s*:=\s*0\s*;\s*end\s+if\s*;/i);
  });

  it("a poster-fee job without a positive fee stamp is refused (P0001) before the gift is reserved or consumed", () => {
    const refuse = body.search(/if\s+v_fee_cents\s*<=\s*0\s+then\s+raise\s+exception\s+'(?:[^']|'')*'\s+using\s+errcode\s*=\s*'P0001'/i);
    expect(refuse).toBeGreaterThan(0);
    const firstGiftWrite = body.search(/update\s+gift_cards/i);
    expect(firstGiftWrite).toBeGreaterThan(0);
    expect(refuse).toBeLessThan(firstGiftWrite);
  });

  it("both outcomes return fee_cents (create-payment refuses a shortfall priced at another fee)", () => {
    const returns = [...body.matchAll(/return\s+jsonb_build_object\(([\s\S]*?)\);/gi)].map((m) => m[1]);
    const outcomes = returns.filter((r) => /'outcome',\s*'(needs_payment|settled)'/i.test(r));
    expect(outcomes.length).toBe(2);
    for (const r of outcomes) expect(r).toMatch(/'fee_cents',\s*v_fee_cents/i);
  });
});
