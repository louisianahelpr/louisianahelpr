/**
 * Q1939: a Declutter seller-fault setup job the refund trigger could not cancel (lock timeout, refused write) is
 * re-applied automatically: declutter_seller_fault_sweep runs declutter_apply_seller_fault on every seller-fault refund
 * with an unmarked setup job the apply would cancel, and void-cancelled-payments calls it BEFORE it prices any job.
 * Backend proof: src/test/pglite/declutterSellerFaultSweep.pglite.mjs (3x; red without the migration and on its planted
 * defects).
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts | await supabaseAdmin.rpc("declutter_seller_fault_sweep", {}) | await supabaseAdmin.rpc("declutter_seller_fault_sweep_off", {})
 * @mutate supabase/migrations/20261102035736_declutter_seller_fault_sweep.sql |      WHERE rf.fee_policy = 'full_seller_pays_fee' AND rf.order_id IS NOT NULL |      WHERE rf.order_id IS NOT NULL
 * @mutate supabase/migrations/20261102035736_declutter_seller_fault_sweep.sql | AND l.created_at <= rf.created_at | AND true
 * @mutate supabase/migrations/20261102035736_declutter_seller_fault_sweep.sql |       v_n := v_n + public.declutter_apply_seller_fault(r.id, false); |       v_n := v_n + public.declutter_apply_seller_fault(r.id, true);
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("a seller-fault setup job the trigger missed is re-applied by the sweep", () => {
  it("the sweep picks only what the apply would cancel, linked before the refund, never a committed no-show", () => {
    expect(defs.size).toBeGreaterThan(500);
    const body = flat(blankSqlComments(defs.get("declutter_seller_fault_sweep")?.stmt ?? ""));
    expect(body.length).toBeGreaterThan(800);
    expect(body).toContain("WHERE rf.fee_policy = 'full_seller_pays_fee' AND rf.order_id IS NOT NULL");
    expect(body).toContain("AND l.seller_fault_refund_id IS NULL AND l.created_at <= rf.created_at");
    expect(body).toContain("AND NOT (rf.reason = 'seller_no_show' AND jb.helper_id IS NOT NULL AND jb.helper_confirmed_at IS NOT NULL)");
    expect(body).toContain("v_n := v_n + public.declutter_apply_seller_fault(r.id, false);");
    // The apply the sweep calls still refuses anything that is not the seller's fault.
    const apply = flat(blankSqlComments(defs.get("declutter_apply_seller_fault")?.stmt ?? ""));
    expect(apply).toContain("rf.fee_policy IS DISTINCT FROM 'full_seller_pays_fee'");
  });

  it("void-cancelled-payments runs it before pricing any cancelled job", () => {
    const fn = blankComments(readFileSync(join(process.cwd(), "supabase/functions/void-cancelled-payments/index.ts"), "utf8"));
    const call = fn.indexOf('await supabaseAdmin.rpc("declutter_seller_fault_sweep", {})');
    expect(call).toBeGreaterThan(0);
    expect(call).toBeLessThan(fn.indexOf('.select("seller_fault_refund_id")'));
    expect(fn).toContain("defects.record(`declutter_seller_fault_sweep failed: ${faultSweepErr.message}`.slice(0, 200));");
  });
});
