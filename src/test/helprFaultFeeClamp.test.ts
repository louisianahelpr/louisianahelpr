/**
 * Q2172 (b), (c), (d) (lead 11-02: B1 + C1's clamp), read from the NEWEST
 * definitions (effectiveDefs, any dollar tag, comments blanked):
 *   - (b) restore_helpr_fault_fee no longer treats a 'reversed' transfer as
 *     carrying the deduction: only 'pending' or 'paid' blocks the give-back;
 *   - (c)/(d) clamp_helpr_fault_fee gives back what a job's payout booked
 *     above the cents its claim (or the current cap) withholds, newest debt
 *     first, never once a paid payout carries it, service_role only.
 * Behaviour (real Postgres, applied 3x, Supabase's default anon grant
 * emulated): src/test/pglite/helprFaultFeeClamp.pglite.mjs (28 PASS; 16 FAIL
 * with NEW_MIGRATION=skip; 6 planted defects each RED).
 *
 * @mutate supabase/migrations/20261102080407_helpr_fault_fee_clamp_and_reversed_restore.sql | AND pt.status IN ('pending', 'paid')) THEN | AND pt.status IN ('pending', 'paid', 'reversed')) THEN
 * @mutate supabase/migrations/20261102080407_helpr_fault_fee_clamp_and_reversed_restore.sql |      ORDER BY created_at DESC, kind DESC, debt_id DESC |      ORDER BY created_at, kind, debt_id
 * @mutate supabase/migrations/20261102080407_helpr_fault_fee_clamp_and_reversed_restore.sql | AND pt.status = 'paid') THEN | AND false) THEN
 * @mutate supabase/migrations/20261102080407_helpr_fault_fee_clamp_and_reversed_restore.sql |         SET remaining_cents = least(card_fee_cents, remaining_cents + v_back) |         SET remaining_cents = remaining_cents
 * @mutate supabase/migrations/20261102080407_helpr_fault_fee_clamp_and_reversed_restore.sql | REVOKE ALL ON FUNCTION public.clamp_helpr_fault_fee(uuid, uuid, integer) FROM PUBLIC, anon, authenticated; | REVOKE ALL ON FUNCTION public.clamp_helpr_fault_fee(uuid, uuid, integer) FROM PUBLIC;
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { effectiveDefs, migrationFiles } from "./helpers/effectiveFunctionDefs";
import { bodyOf } from "./helpers/migrationTriggers";
import { blankSqlComments } from "./helpers/blankNonCode";

const DIR = "supabase/migrations";
const FIX = "20261102080407";
const body = (fn: string, before?: string) => {
  const def = effectiveDefs(DIR, before ? { before } : {}).get(fn);
  return def ? bodyOf(def.stmt) : "";
};
const grantsText = (fn: string) =>
  migrationFiles(DIR)
    .map((f) => blankSqlComments(readFileSync(join(DIR, f), "utf8")))
    .filter((sql) => sql.includes(`ON FUNCTION public.${fn}(`))
    .pop() ?? "";

describe("Q2172: the Helpr-fault deduction is given back when it was not collected", () => {
  it("(b) a reversed transfer no longer blocks restore; pending and paid still do", () => {
    const b = body("restore_helpr_fault_fee");
    const gate = /pt\.status IN \(([^)]*)\)/.exec(b)?.[1] ?? "";
    expect(gate).toBe("'pending', 'paid'");
    // Before the fix a reversed row blocked it (can fail).
    expect(body("restore_helpr_fault_fee", FIX)).toMatch(/pt\.status IN \('pending', 'paid', 'reversed'\)/);
    // Still gives back both kinds.
    expect(b).toMatch(/DELETE FROM public\.helpr_card_fee_debt_deductions d/);
    expect(b).toMatch(/DELETE FROM public\.job_helpr_fault_fee_deductions d/);
  });

  it("(c)/(d) clamp gives back the excess newest-first, never from a paid payout", () => {
    const b = body("clamp_helpr_fault_fee");
    expect(b.length).toBeGreaterThan(500);
    expect(body("clamp_helpr_fault_fee", FIX)).toBe("");
    expect(b).toMatch(/pt\.status = 'paid'\) THEN\s+RAISE EXCEPTION 'payout_already_paid'/);
    expect(b).toMatch(/ORDER BY created_at DESC, kind DESC, debt_id DESC/);
    expect(b).toMatch(/SET card_fee_remaining_cents = least\(card_fee_cents, card_fee_remaining_cents \+ v_back\)/);
    expect(b).toMatch(/SET remaining_cents = least\(card_fee_cents, remaining_cents \+ v_back\)/);
    expect(b).toMatch(/pg_advisory_xact_lock\(hashtextextended\('helpr_fault_fee:'/);
  });

  it("only service_role runs clamp and restore (Supabase's default anon grant revoked by name)", () => {
    const fns = ["clamp_helpr_fault_fee", "restore_helpr_fault_fee"];
    for (const fn of fns) {
      const sql = grantsText(fn);
      expect(sql, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`));
      expect(sql, fn).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`));
    }
    expect(fns.length).toBeGreaterThan(1);
  });
});
