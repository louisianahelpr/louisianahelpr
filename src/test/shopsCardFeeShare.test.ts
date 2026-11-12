/**
 * S053 (Shops audit 11-12): the card fee recorded at capture is the sale's share of Stripe's fee when the charge also
 * carried the buyer's one-time setup fee, so a buyer's own cancel (keep_card_fee) and a cancelling shop never pay
 * Stripe's fee on Helpr's setup fee. Reads the EFFECTIVE (newest) shop_order_captured; behaviour on a real database is
 * src/test/pglite/shopsCardFeeShare.pglite.mjs (3x; skip red; 5 planted defects each RED).
 *
 * @mutate supabase/migrations/20261112095500_shops_card_fee_without_setup_fee.sql |            * v_paid / NULLIF(v_paid + v_fee, 0))::integer) |            * 1)::integer)
 * @mutate supabase/migrations/20261112095500_shops_card_fee_without_setup_fee.sql | NULLIF(v_paid + v_fee, 0) | NULLIF(v_paid, 0)
 * @mutate supabase/migrations/20261112095500_shops_card_fee_without_setup_fee.sql | card_fee_cents = least(v_paid, round( | card_fee_cents = least(v_paid, trunc(
 * @mutate supabase/migrations/20261112095500_shops_card_fee_without_setup_fee.sql | THEN o.total_cents - COALESCE(o.balance_cents, 0) ELSE | THEN o.total_cents ELSE
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("S053: the recorded card fee leaves out the setup fee's share", () => {
  it("shop_order_captured scales Stripe's fee by sale / (sale + setup fee), rounded, capped at the sale", () => {
    const body = flat("shop_order_captured");
    expect(body.length).toBeGreaterThan(800);
    expect(body).toContain("v_fee := CASE WHEN o.setup_fee_state = 'claimed' THEN o.setup_fee_cents ELSE 0 END;");
    expect(body).toContain("v_paid := CASE WHEN o.payment_plan = 'deposit_50' THEN o.total_cents - COALESCE(o.balance_cents, 0) ELSE o.total_cents END;");
    expect(body).toContain(
      "card_fee_cents = least(v_paid, round( COALESCE(p_card_fee_cents, public.declutter_card_fee_estimate(v_paid + v_fee))::numeric * v_paid / NULLIF(v_paid + v_fee, 0))::integer)",
    );
  });
});
