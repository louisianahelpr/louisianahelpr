/**
 * S011 money note (Shops audit 11-12): two orders finishing before the first payout is sent both subtracted the one-time
 * setup fee in their "Order picked up / finished" notices. The newest shop_complete_handover now asks
 * setup_fee_other_payout_first and, when another unsent payout could take the fee, names it as still to come
 * (20261112093000; behaviour proof src/test/pglite/shopsSetupFeeNoticeExact.pglite.mjs).
 *
 * @mutate supabase/migrations/20261112093000_shops_setup_fee_notice_exact.sql |     IF v_setup_fee > 0 AND public.setup_fee_other_payout_first(o.seller_id, v_payout, v_setup_fee) THEN |     IF false THEN
 * @mutate supabase/migrations/20261112093000_shops_setup_fee_notice_exact.sql |         END) \|\| public.setup_fee_later_words(v_fee_later) |         END)
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MIG = "supabase/migrations/";
function newestBody(fn: string): string {
  const file = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort().reverse()
    .find((f) => readFileSync(MIG + f, "utf8").includes(`CREATE OR REPLACE FUNCTION public.${fn}(`))!;
  const t = readFileSync(MIG + file, "utf8");
  const s = t.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const tag = t.slice(s).match(/\nAS (\$[a-z_]*\$)/)![1];
  const open = t.indexOf(`\nAS ${tag}`, s) + 4 + tag.length;
  return t.slice(open, t.indexOf(`\n${tag}`, open));
}

describe("the shop's payout notice names the setup fee exactly", () => {
  it("does not subtract the fee when another unsent payout could take it first", () => {
    const body = newestBody("shop_complete_handover");
    expect(body).toContain("IF v_setup_fee > 0 AND public.setup_fee_other_payout_first(o.seller_id, v_payout, v_setup_fee) THEN");
    expect(body).toMatch(/v_fee_later := v_setup_fee;\s*v_setup_fee := 0;/);
  });
  it("says the fee comes out of the first payout sent, in every amount branch", () => {
    const body = newestBody("shop_complete_handover");
    expect((body.match(/\|\| public\.setup_fee_later_words\(v_fee_later\)/g) ?? []).length).toBe(3);
    expect(newestBody("setup_fee_later_words")).toContain("setup fee comes out of the first payout we send. We tell you when it does.");
  });
});
