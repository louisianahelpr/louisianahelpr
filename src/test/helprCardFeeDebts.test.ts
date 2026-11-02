/**
 * Q2245 step a (owner MASTER-LIST 2026-10-21): a Helpr whose setup lapsed
 * after their series visit was paid pays that charge's card fee from their
 * NEXT payout; the poster is refunded in full. The debt is
 * public.helpr_card_fee_debts (one per visit payment), billed by
 * bill_helpr_card_fee_debt, and taken by the SAME take/restore pair every
 * payout path already calls for the at-fault card fee.
 *
 * Read from the NEWEST definitions (effectiveDefs, any dollar tag, comments
 * blanked):
 *   - take_helpr_fault_fee reads both debts, oldest first, and a retried
 *     payout returns its first answer for both;
 *   - restore_helpr_fault_fee gives both back;
 *   - bill_helpr_card_fee_debt bills a visit once, capped at its charge, and
 *     only service_role may run any of the three.
 * Behaviour (real Postgres, applied 3x, Supabase's default anon grant
 * emulated): src/test/pglite/helprCardFeeDebts.pglite.mjs (44 PASS; 35 FAIL
 * with NEW_MIGRATION=skip; 7 planted defects each RED).
 *
 * @mutate supabase/migrations/20261102072106_helpr_card_fee_debts.sql |       FROM public.helpr_card_fee_debts c\n     WHERE c.helper_id = p_helper_id AND c.remaining_cents > 0\n     ORDER BY |       FROM public.helpr_card_fee_debts c\n     WHERE false\n     ORDER BY
 * @mutate supabase/migrations/20261102072106_helpr_card_fee_debts.sql |      OR EXISTS (SELECT 1 FROM public.helpr_card_fee_debt_deductions x |      OR false AND EXISTS (SELECT 1 FROM public.helpr_card_fee_debt_deductions x
 * @mutate supabase/migrations/20261102072106_helpr_card_fee_debts.sql |     DELETE FROM public.helpr_card_fee_debt_deductions d |     DELETE FROM public.helpr_card_fee_debt_deductions_x d
 * @mutate supabase/migrations/20261102072106_helpr_card_fee_debts.sql |   ON CONFLICT (recurring_visit_payment_id) DO NOTHING\n |
 * @mutate supabase/migrations/20261102072106_helpr_card_fee_debts.sql |   v_cents := least(p_card_fee_cents, v_row.amount_cents); |   v_cents := p_card_fee_cents;
 * @mutate supabase/migrations/20261102072106_helpr_card_fee_debts.sql | REVOKE ALL ON FUNCTION public.bill_helpr_card_fee_debt(uuid, integer, text) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.bill_helpr_card_fee_debt(uuid, integer, text) FROM PUBLIC;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf } from "./helpers/migrationTriggers";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FIX = "20261102072106";
const body = (fn: string, before?: string) => {
  const def = effectiveDefs(DIR, before ? { before } : {}).get(fn);
  expect(def, `${fn} is gone`).toBeTruthy();
  return bodyOf(def!.stmt);
};
/** The newest migration text that touches `fn`'s grants (comments blanked). */
const grantsText = (fn: string) =>
  migrationFiles(DIR)
    .map((f) => blankSqlComments(readFileSync(join(DIR, f), "utf8")))
    .filter((sql) => sql.includes(`ON FUNCTION public.${fn}(`))
    .pop() ?? "";

describe("Q2245: a lapsed Helpr's card-fee debt comes out of their next payout", () => {
  it("take_helpr_fault_fee takes both debts, oldest first, under one lock", () => {
    const b = body("take_helpr_fault_fee");
    expect(b).toMatch(/FROM public\.job_helpr_fault_rulings r\s+WHERE r\.helper_id = p_helper_id AND r\.card_fee_remaining_cents > 0/);
    expect(b).toMatch(/FROM public\.helpr_card_fee_debts c\s+WHERE c\.helper_id = p_helper_id AND c\.remaining_cents > 0\s+ORDER BY created_at/);
    expect(b).toMatch(/INSERT INTO public\.helpr_card_fee_debt_deductions/);
    expect(b).toMatch(/pg_advisory_xact_lock\(hashtextextended\('helpr_fault_fee:'/);
    // Before the fix the pair knew only the rulings (can fail).
    expect(body("take_helpr_fault_fee", FIX)).not.toMatch(/helpr_card_fee_debts/);
  });

  it("a retried payout returns its first answer for BOTH kinds (never takes twice)", () => {
    const b = body("take_helpr_fault_fee");
    const retry = b.slice(0, b.indexOf("RETURN v_took;"));
    expect(retry).toMatch(/OR EXISTS \(SELECT 1 FROM public\.helpr_card_fee_debt_deductions x/);
    expect(retry).toMatch(/sum\(x\.deducted_cents\) FROM public\.helpr_card_fee_debt_deductions x/);
  });

  it("restore_helpr_fault_fee gives back both kinds, never while a live payout carries it", () => {
    const b = body("restore_helpr_fault_fee");
    expect(b).toMatch(/DELETE FROM public\.helpr_card_fee_debt_deductions d/);
    expect(b).toMatch(/SET remaining_cents = least\(card_fee_cents, remaining_cents \+ x\.deducted_cents\)/);
    expect(b.indexOf("payout_transfers")).toBeLessThan(b.indexOf("helpr_card_fee_debt_deductions"));
  });

  it("bill_helpr_card_fee_debt bills a paid visit's own Helpr once, capped at the charge", () => {
    const b = body("bill_helpr_card_fee_debt");
    expect(b).toMatch(/ON CONFLICT \(recurring_visit_payment_id\) DO NOTHING/);
    expect(b).toMatch(/v_cents := least\(p_card_fee_cents, v_row\.amount_cents\);/);
    expect(b).toMatch(/v_row\.helper_id IS NULL THEN\s+RAISE EXCEPTION 'visit_payment_no_helper'/);
    expect(b).toMatch(/v_row\.stripe_payment_intent_id IS NULL THEN\s+RAISE EXCEPTION 'visit_payment_not_paid'/);
  });

  it("only service_role runs bill, take and restore (Supabase's default anon grant revoked by name)", () => {
    const fns = ["bill_helpr_card_fee_debt", "take_helpr_fault_fee", "restore_helpr_fault_fee"];
    for (const fn of fns) {
      const sql = grantsText(fn);
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
    expect(fns.length).toBeGreaterThan(2);
  });
});
