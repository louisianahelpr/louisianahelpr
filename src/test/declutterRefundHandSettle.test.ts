/**
 * Declutter refunds that give up, and refunds made by hand, reach the books
 * (20261017052700_declutter_refund_hand_settle; lh-money-escrow should-fixes
 * (a) and (b) in docs/specs/declutter-auctions.md "Open after slice 4").
 * The fast half, read from the NEWEST definitions (effectiveDefs), so a later
 * restatement that drops the gave-up alert or the hand-refund rules fails here.
 *
 * Behaviour (3x replay, migration skipped = RED):
 * src/test/pglite/declutterRefundHandSettle.pglite.mjs. Edge side:
 * src/test/edge/declutter-payments.test.ts and src/test/edge/declutter-money.test.ts.
 *
 * @mutate supabase/migrations/20261017052700_declutter_refund_hand_settle.sql |   ELSIF v_status = 'failed' THEN\n    PERFORM public.declutter_refund_gave_up_check(p_refund_id); |   ELSIF false THEN\n    PERFORM public.declutter_refund_gave_up_check(p_refund_id);
 * @mutate supabase/migrations/20261017052700_declutter_refund_hand_settle.sql |   IF v_attempts >= 12 THEN\n    PERFORM public.declutter_refund_gave_up_check(p_refund_id); |   IF false THEN\n    PERFORM public.declutter_refund_gave_up_check(p_refund_id);
 * @mutate supabase/migrations/20261017052700_declutter_refund_hand_settle.sql |      WHERE d.status = 'failed' AND d.attempts >= 12 |      WHERE d.status = 'failed' AND d.attempts >= 13
 * @mutate supabase/migrations/20261017052700_declutter_refund_hand_settle.sql | v_row.status <> 'succeeded' AND v_covered >= v_row.refund_cents; | v_row.status <> 'succeeded';
 * @mutate supabase/migrations/20261017052700_declutter_refund_hand_settle.sql |      SET status = 'failed', next_attempt_at = now(), gave_up_notified_at = NULL, |      SET next_attempt_at = now(), gave_up_notified_at = NULL,
 * @mutate supabase/migrations/20261017052700_declutter_refund_hand_settle.sql | REVOKE ALL ON FUNCTION public.declutter_record_hand_refund(text, text, integer, boolean) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.declutter_record_hand_refund(text, text, integer, boolean) FROM PUBLIC;
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const MIG_DIR = join(process.cwd(), "supabase/migrations");
const DEFS = effectiveDefs(MIG_DIR);
const body = (name: string) => blankSqlComments(DEFS.get(name)?.stmt ?? "");
const flat = (s: string) => s.replace(/\s+/g, " ");

const FNS = ["declutter_refund_gave_up_check", "declutter_refund_executed", "declutter_refund_reversed", "declutter_record_hand_refund", "declutter_hand_refund_failed"];

describe("Declutter refunds that give up, and refunds made by hand (20261017052700)", () => {
  it("reads a real inventory (floors)", () => {
    for (const fn of FNS) expect(body(fn), fn).not.toBe("");
    expect(FNS.length).toBeGreaterThan(3);
  });

  it("the failure that uses the 12th try, and a reversal that does, raise the gave-up alert", () => {
    expect(flat(body("declutter_refund_executed"))).toMatch(/ELSIF v_status = 'failed' THEN PERFORM public\.declutter_refund_gave_up_check\(p_refund_id\)/);
    expect(flat(body("declutter_refund_reversed"))).toMatch(/IF v_attempts >= 12 THEN PERFORM public\.declutter_refund_gave_up_check\(p_refund_id\)/);
  });

  it("the gave-up check matches the queue's cap (attempts < 12 is offered; >= 12 has given up)", () => {
    const due = flat(body("declutter_refunds_due"));
    expect(due).toMatch(/r\.attempts < 12/);
    expect(flat(body("declutter_refund_gave_up_check"))).toMatch(/d\.status = 'failed' AND d\.attempts >= 12/);
  });

  it("the alert goes through error_logs (the ops ledger) with one title, and the buyer notice is sent once", () => {
    const b = flat(body("declutter_refund_gave_up_check"));
    expect(b).toMatch(/INSERT INTO public\.error_logs/);
    expect(b).toMatch(/'source', 'declutter-refund-gave-up'/);
    expect(b).toMatch(/gave_up_notified_at IS NULL/);
    expect(b).toMatch(/declutter_notify\(r\.buyer_id/);
  });

  it("a hand refund settles a row only when it covers what the row owes, and never moves money", () => {
    const b = flat(body("declutter_record_hand_refund"));
    expect(b).toMatch(/v_row\.status <> 'succeeded' AND v_covered >= v_row\.refund_cents/);
    expect(b).toMatch(/h\.failed_at IS NULL/);
    expect(b).toMatch(/ON CONFLICT \(stripe_refund_id\) DO NOTHING/);
    expect(b).toMatch(/FOR UPDATE/);
    // No payout or refund queue is touched: only the refund row and the books.
    expect(b).not.toMatch(/declutter_payouts|declutter_orders SET|net\.http/i);
  });

  it("the new functions are service-only", () => {
    const mig = blankSqlComments(readFileSync(join(MIG_DIR, "20261017052700_declutter_refund_hand_settle.sql"), "utf8"));
    for (const [fn, sig] of [
      ["declutter_refund_gave_up_check", "uuid"],
      ["declutter_record_hand_refund", "text, text, integer, boolean"],
      ["declutter_hand_refund_failed", "text, text"],
    ] as const) {
      expect(mig, fn).toContain(`REVOKE ALL ON FUNCTION public.${fn}(${sig}) FROM PUBLIC, anon, authenticated;`);
      expect(mig, fn).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}(${sig}) TO service_role;`);
    }
  });
});
