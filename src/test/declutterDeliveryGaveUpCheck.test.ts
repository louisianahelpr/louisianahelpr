/**
 * Q1931: Declutter delivery money that used its 12 tries (a Helpr's delivery pay, a delivery-fee refund, a delivery
 * pay-raise refund) is never left silent: declutter_delivery_gave_up_check raises one ops-ledger row per row per day
 * while it is stuck and tells the person owed the money once; declutter-money calls it on every run, AFTER the queues.
 * Backend proof: src/test/pglite/declutterDeliveryGaveUpCheck.pglite.mjs (3x; red without the migration and on its
 * planted defects).
 *
 * @mutate supabase/functions/declutter-money/index.ts | admin.rpc("declutter_delivery_gave_up_check", {}) | admin.rpc("declutter_delivery_gave_up_check_off", {})
 * @mutate supabase/migrations/20261102070238_declutter_gave_up_notice_no_fee_words.sql |        WHERE p.status = 'failed' AND p.attempts >= 12 |        WHERE p.status = 'failed' AND p.attempts >= 99
 * @mutate supabase/migrations/20261102070238_declutter_gave_up_notice_no_fee_words.sql |        WHERE d.status = 'failed' AND d.attempts >= 12 |        WHERE d.status = 'succeeded' AND d.attempts >= 12
 * @mutate supabase/migrations/20261102070238_declutter_gave_up_notice_no_fee_words.sql |        WHERE g.status = 'refunding' AND g.refund_attempts >= 12 |        WHERE g.status = 'refunded' AND g.refund_attempts >= 12
 * @mutate supabase/migrations/20261102070238_declutter_gave_up_notice_no_fee_words.sql |            AND e.created_at > date_trunc('day', now()) |            AND e.created_at > now() + interval '1 day'
 * @mutate supabase/migrations/20261102070238_declutter_gave_up_notice_no_fee_words.sql | REVOKE ALL ON FUNCTION public.declutter_delivery_gave_up_check() FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_delivery_gave_up_check() FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const defs = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));
const flat = (s: string) => s.replace(/\s+/g, " ");
const MIG = flat(blankSqlComments(readFileSync(join(process.cwd(), "supabase/migrations/20261102070238_declutter_gave_up_notice_no_fee_words.sql"), "utf8")));

describe("Declutter delivery money that gave up is raised daily and the payee is told once", () => {
  it("the check covers all three delivery queues at their 12-try cap", () => {
    expect(defs.size).toBeGreaterThan(500);
    const body = flat(blankSqlComments(defs.get("declutter_delivery_gave_up_check")?.stmt ?? ""));
    expect(body.length).toBeGreaterThan(1500);
    expect(body).toContain("FROM public.helpr_task_payouts p WHERE p.status = 'failed' AND p.attempts >= 12");
    expect(body).toContain("WHERE d.status = 'failed' AND d.attempts >= 12");
    expect(body).toContain("WHERE g.status = 'refunding' AND g.refund_attempts >= 12");
    // The queues stop at the same cap the check starts at.
    for (const q of ["helpr_task_payouts_due", "declutter_delivery_refunds_due"]) {
      expect(flat(defs.get(q)?.stmt ?? "")).toContain("attempts < 12");
    }
    expect(flat(defs.get("declutter_delivery_raise_refunds_due")?.stmt ?? "")).toContain("r.refund_attempts < 12");
  });

  it("one ledger row per row per day, never muted by a client row, and service role only", () => {
    const body = flat(blankSqlComments(defs.get("declutter_delivery_gave_up_check")?.stmt ?? ""));
    expect(body).toContain("AND coalesce(e.tags ->> 'origin', '') <> 'client' AND e.tags ->> 'source' = 'declutter-delivery-gave-up'");
    expect(body).toContain("AND e.created_at > date_trunc('day', now())");
    expect(MIG).toContain("REVOKE ALL ON FUNCTION public.declutter_delivery_gave_up_check() FROM PUBLIC, anon, authenticated;");
  });

  it("declutter-money calls it after the delivery and raise queues, and a failure is a defect", () => {
    const fn = blankComments(readFileSync(join(process.cwd(), "supabase/functions/declutter-money/index.ts"), "utf8"));
    const call = fn.indexOf('admin.rpc("declutter_delivery_gave_up_check", {})');
    expect(call).toBeGreaterThan(0);
    expect(call).toBeGreaterThan(fn.lastIndexOf('admin.rpc("declutter_delivery_raise_refund_executed"'));
    expect(call).toBeGreaterThan(fn.lastIndexOf('admin.rpc("declutter_delivery_refund_executed"'));
    expect(call).toBeGreaterThan(fn.lastIndexOf('admin.rpc("helpr_task_payout_executed"'));
    expect(fn).toContain("defects.record(`declutter_delivery_gave_up_check failed: ${deliveryGaveUp.error.message}`);");
  });
});
