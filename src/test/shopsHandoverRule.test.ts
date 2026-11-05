/**
 * Shops H5 (audit ~/.lh-shots/audit-1105-shops.md H5; L23 "Handover same as Declutter"): a Shops order follows
 * Declutter's 10-30 handover rule (migration 20261105182903_shops_handover_rule.sql).
 *
 * Read from the NEWEST definitions:
 *   - the sweep pays only after the shop said it is done (in person: "Handed over"; left out: the ready photo), 48
 *     hours on with no report, and never on the ready date's clock alone;
 *   - with nobody tapping it only nudges and tells admins at 60 days, skipping test and seed orders;
 *   - the shop's "Handed over" never calls the transition (the shop still cannot finish its own order).
 *
 * Behaviour: src/test/pglite/shopsHandoverRule.pglite.mjs (24/24 applied 3x; --before 18 FAIL).
 *
 * @mutate supabase/migrations/20261105182903_shops_handover_rule.sql |              AND h.shop_confirmed_at + interval '48 hours' <= now()) |              AND h.shop_confirmed_at + interval '1 hour' <= now())
 * @mutate supabase/migrations/20261105182903_shops_handover_rule.sql |       AND ((o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NOT NULL | AND ((o.handover_mode = 'in_person'
 * @mutate supabase/migrations/20261105182903_shops_handover_rule.sql |        AND o.is_seed IS NOT TRUE\n |
 * @mutate src/components/shops/ShopHandoverActions.tsx |           {!porch && due && !h?.shop_confirmed_at && ( |           {false && (
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const root = resolve(__dirname, "../..");
const DEFS = effectiveDefs(resolve(root, "supabase/migrations"));
const ws = (s: string) => s.replace(/\s+/g, " ");
const body = (fn: string) => {
  const stmt = DEFS.get(fn)?.stmt;
  expect(stmt, `${fn} has a definition`).toBeTruthy();
  return ws(blankSqlComments(stmt ?? ""));
};

describe("Shops H5: the handover follows Declutter's 10-30 rule", () => {
  it("the sweep pays only 48 hours after the shop's word, never on the ready date's clock alone", () => {
    const sweep = body("shop_handover_sweep");
    expect(sweep).toContain("o.handover_mode = 'in_person' AND h.shop_confirmed_at IS NOT NULL AND h.shop_confirmed_at + interval '48 hours' <= now()");
    expect(sweep).toContain("o.handover_mode = 'porch' AND h.ready_photo_path IS NOT NULL");
    expect(sweep).toContain("+ interval '48 hours' <= now()))");
    // Exactly one call of the transition, inside the first loop (the nudge loop moves no money).
    const calls = [...sweep.matchAll(/shop_complete_handover\(/g)].length;
    expect(calls).toBe(1);
    expect(sweep.indexOf("shop_complete_handover(")).toBeLessThan(sweep.indexOf("held_nudged_at"));
  });

  it("with nobody tapping: nudges, then admins at 60 days, never for test or seed orders", () => {
    const sweep = body("shop_handover_sweep");
    expect(sweep).toContain("h.held_nudged_at + interval '7 days' <= now()");
    expect(sweep).toContain("+ interval '60 days' <= now()");
    expect(sweep).toContain("o.is_seed IS NOT TRUE");
    expect(sweep).toContain("FROM public.test_accounts t");
    expect(sweep).toContain("public.is_test_subject(r.buyer_id)");
  });

  it("the shop's \"Handed over\" never finishes the order, and its client button exists", () => {
    const tap = body("shops_mark_handed_over");
    expect(tap).not.toContain("shop_complete_handover");
    expect(tap).toContain("o.seller_id IS DISTINCT FROM v_uid");
    expect(tap).toContain("public.is_caller_banned()");
    expect(tap).toContain("public.shop_local_today() < o.ready_date");
    const ui = ws(blankComments(readFileSync(resolve(root, "src/components/shops/ShopHandoverActions.tsx"), "utf8")));
    expect(ui).toContain("{!porch && due && !h?.shop_confirmed_at && (");
    expect(ui).toContain("markHandedOver(order.id)");
  });
});
