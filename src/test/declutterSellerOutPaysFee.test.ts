/**
 * A buyer who pays just as the SELLER can no longer sell gets every cent back,
 * and the card fee is the SELLER's debt (owner answer 7, 2026-10-17;
 * 20261017060455_declutter_seller_out_pays_fee). The fast half, read from the
 * NEWEST definitions (effectiveDefs), so a later restatement of
 * declutter_mark_order_paid that sends a seller-out payment back to
 * order_closed / sold_elsewhere (the platform paying the fee) fails here.
 *
 * Behaviour (3x replay, migration skipped = RED):
 * src/test/pglite/declutterSellerOutPaysFee.pglite.mjs. The reason -> policy
 * map itself is pinned in src/test/refundsKeepTheCardFee.test.ts.
 *
 * @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql |     ELSIF o.close_reason = 'seller_out' THEN | ELSIF false THEN
 * @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql | v_reason := CASE WHEN v_items_ok AND v_cant | v_reason := CASE WHEN v_cant
 * lh-money-escrow review of 905501cb2 #1: (b) judges seller_out on the items alone, so a buyer's block does not hand the fee to us.
 * @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql |       v_sale_ok := v_items_ok\n        AND NOT EXISTS | v_items_ok := v_items_ok AND NOT EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocked_id = o.seller_id OR b.blocker_id = o.seller_id);\n      v_sale_ok := v_items_ok\n        AND NOT EXISTS
 * @mutate supabase/migrations/20261028210552_declutter_sale_notices_name_inline.sql | WHEN v_cant AND v_items_ok THEN 'seller_out' | WHEN v_cant THEN 'seller_out'
 * @mutate supabase/migrations/20261017060455_declutter_seller_out_pays_fee.sql |   IF o.seller_id IS NULL OR v_debt IS NULL OR v_debt <= 0 THEN |   IF true THEN
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const FILE = "20261017060455_declutter_seller_out_pays_fee.sql";
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");
const NOTICE = "IF v_reason = 'seller_out' THEN PERFORM public.declutter_seller_out_fee_notice(v_refund); END IF;";

describe("Declutter: a seller who can no longer sell owes the card fee (20261017060455)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of ["declutter_mark_order_paid", "declutter_record_refund", "declutter_seller_out_fee_notice"]) {
      expect(body(fn), fn).not.toBe("");
    }
    expect(flat(body("declutter_mark_order_paid")).split("'seller_out'").length - 1).toBeGreaterThan(3);
  });

  it("all three seller-out paths record 'seller_out', never our own-mistake reasons", () => {
    const b = flat(body("declutter_mark_order_paid"));
    // (a) the sweep closed the checkout because the seller was out.
    expect(b).toMatch(/ELSIF o\.close_reason = 'seller_out' THEN v_reason := 'seller_out';/);
    // Read once (review #3).
    expect(b.split("public.declutter_seller_out(").length - 1).toBe(1);
    expect(b).toContain("v_cant := public.declutter_seller_out(o.seller_id);");
    // (b) a late in-time payment that cannot be honoured: only when being out is the sole blocker.
    expect(b).toContain("v_honour := v_sale_ok AND NOT v_cant;");
    // Judged on the items alone (lh-money-escrow review of 905501cb2 #1), as (c) does: a seller who is
    // out wins over a buyer who blocked them; a seller's own block is not seller_out.
    expect(b).toMatch(/v_sale_ok := v_items_ok AND NOT EXISTS \(SELECT 1 FROM public\.user_blocks b/);
    const itemsOk = [...b.matchAll(/v_items_ok := [^;]*;/g)].map((m) => m[0]);
    expect(itemsOk.length).toBeGreaterThan(1); // (b) and (c)
    for (const a of itemsOk) expect(a, "v_items_ok never reads a block").not.toContain("user_blocks");
    expect(b).toContain("v_reason := CASE WHEN v_items_ok AND v_cant AND NOT EXISTS (SELECT 1 FROM public.user_blocks b"
      + " WHERE b.blocker_id = o.seller_id AND b.blocked_id = o.buyer_id) THEN 'seller_out' ELSE 'sold_elsewhere' END;");
    // (c) an open checkout: after the seller's own block, before the buyer's, only on a whole sale.
    expect(b).toMatch(/THEN 'seller_backed_out' WHEN v_cant AND v_items_ok THEN 'seller_out' WHEN EXISTS/);
  });

  it("seller_out is the seller's fault: full refund, the card fee booked as their debt", () => {
    expect(flat(body("declutter_record_refund"))).toContain(
      "WHEN p_reason IN ('seller_backed_out', 'seller_out', 'seller_no_show', 'not_as_described', 'helpr_fault') THEN 'full_seller_pays_fee'");
  });

  it("the seller is told after each seller-out refund is recorded, once per payment", () => {
    const b = flat(body("declutter_mark_order_paid"));
    expect(b.split(NOTICE).length - 1).toBe(3);
    // A replayed payment returns the recorded answer before any path runs.
    expect(b.indexOf("IF v_refund IS NOT NULL THEN RETURN public.declutter_refund_answer(v_refund); END IF;"))
      .toBeLessThan(b.indexOf(NOTICE));
    const n = flat(body("declutter_seller_out_fee_notice"));
    expect(n).toContain("FROM public.declutter_seller_fee_debts d WHERE d.refund_id = p_refund_id");
    // The order comes from the refund row, never a second argument (review #9).
    expect(n).toContain("FROM public.declutter_refunds r JOIN public.declutter_orders x ON x.id = r.order_id WHERE r.id = p_refund_id");
    expect(n).toContain("IF o.seller_id IS NULL OR v_debt IS NULL OR v_debt <= 0 THEN RETURN;");
  });

  it("the notice helper is service-only", () => {
    const mig = blankSqlComments(readFileSync(join(MIG_DIR, FILE), "utf8"));
    expect(mig).toContain("REVOKE ALL ON FUNCTION public.declutter_seller_out_fee_notice(uuid) FROM PUBLIC, anon, authenticated;");
    expect(mig).toContain("GRANT EXECUTE ON FUNCTION public.declutter_seller_out_fee_notice(uuid) TO service_role;");
  });
});
