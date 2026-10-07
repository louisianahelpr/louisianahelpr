import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

/**
 * Q1379 (docs/OPEN.md; finding: lh-money-escrow@d0933e1b3#3): the Helpr
 * earnings export held two definitions of net. A single job's net was budget
 * less a default 10% fee (whatever the payout sent); a crew row's net was the
 * paid ledger amount while its gross was the budget share alone, so gross -
 * fee <> net and urgent income was missing from a tax export.
 *
 * THE CLASS: a money column of the export recomputed from job columns while
 * the payout ledger (payout_transfers, status 'paid') records what happened.
 * Every ledger-backed row now reads all three money columns from the ledger:
 * net = paid, fee = recorded fee, gross = paid + fee.
 *
 * Behaviour (measured 2026-10-07): src/test/pglite/earningsExportOneNet.pglite.mjs (6 checks RED on
 * the 20261005171601 body with --before; all green after, applied 3x).
 */

// @mutate supabase/migrations/20261007145338_earnings_export_one_net.sql |            THEN ROUND((COALESCE(pt.paid_cents, 0) + COALESCE(pt.fee_cents, 0)) / 100.0, 2)\n           ELSE j.budget END AS gross_budget, |            THEN j.budget\n           ELSE j.budget END AS gross_budget,
// @mutate supabase/migrations/20261007145338_earnings_export_one_net.sql |       ROUND((pt.paid_cents + pt.fee_cents) / 100.0, 2),\n      ROUND(pt.fee_cents / 100.0, 2), |       ROUND(COALESCE(g.share_cents, 0) / 100.0, 2),\n      ROUND(pt.fee_cents / 100.0, 2),
// @mutate supabase/migrations/20261007145338_earnings_export_one_net.sql |       AND j.is_group_job IS NOT TRUE\n |\n

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const THIS = "20261007145338_earnings_export_one_net.sql";
const def = effectiveDefs(MIGRATIONS).get("get_helper_earnings_export");
const body = blankSqlComments(def?.stmt ?? "").replace(/\s+/g, " ");

describe("Q1379: the earnings export has one definition of net, read from the payout ledger", () => {
  it("the effective export is this migration's, and the parser read a real body", () => {
    expect(def?.file).toBe(THIS);
    expect(body.length).toBeGreaterThan(1000);
  });

  it("both halves read the paid ledger rows for this Helpr", () => {
    const ledger = body.match(/FROM public\.payout_transfers p WHERE p\.job_id = j\.id AND p\.helper_id = (?:_helper_id|g\.helper_id) \)/g) ?? [];
    expect(ledger.length, "one ledger read per half (single, crew), every status").toBe(2);
    // What was KEPT: paid rows in full, a reversed row less its recorded reversal (review finding 1).
    const kept = body.match(/WHEN p\.status = 'reversed' THEN GREATEST\(0, p\.amount_cents - COALESCE\(\(p\.metadata->>'amount_reversed_cents'\)::bigint, p\.amount_cents\)\) END\) AS paid_cents/g) ?? [];
    expect(kept.length, "both halves count the unreversed part of a reversed row").toBe(2);
  });

  it("every ledger-backed money column is ledger-derived: gross = paid + fee, fee = recorded, net = paid", () => {
    const [single, crew] = body.split(" UNION ALL ");
    expect(crew, "the crew half is gone").toBeTruthy();
    // Single job: the ledger when a paid row exists, the legacy recompute only without one.
    // The recompute only when the job has NO ledger row at all (review finding 2).
    expect(single).toContain("CASE WHEN pt.ledger_rows > 0 THEN ROUND((COALESCE(pt.paid_cents, 0) + COALESCE(pt.fee_cents, 0)) / 100.0, 2) ELSE j.budget END AS gross_budget");
    expect(single).toContain("CASE WHEN pt.ledger_rows > 0 THEN ROUND(COALESCE(pt.fee_cents, 0) / 100.0, 2) ELSE");
    expect(single).toContain("CASE WHEN pt.ledger_rows > 0 THEN ROUND(COALESCE(pt.paid_cents, 0) / 100.0, 2) ELSE");
    // A crew is the second half only (review finding 3).
    expect(single).toContain("AND j.is_group_job IS NOT TRUE");
    // Crew: always ledger-backed (the join requires a paid row).
    expect(crew).toContain("ROUND((pt.paid_cents + pt.fee_cents) / 100.0, 2), ROUND(pt.fee_cents / 100.0, 2),");
    expect(crew).toContain(") pt ON pt.paid_cents > 0");
    expect(crew).toMatch(/ROUND\(pt\.paid_cents \/ 100\.0, 2\) FROM public\.group_job_helpers g/);
    expect(crew, "a crew row's gross is the budget share again (no urgent income)").not.toMatch(/ROUND\(COALESCE\(g\.share_cents, 0\) \/ 100\.0, 2\),/);
  });

  it("keeps its grants: authenticated and service_role only", () => {
    const sql = blankSqlComments(readFileSync(resolve(MIGRATIONS, THIS), "utf8"));
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.get_helper_earnings_export(uuid, date, date) FROM PUBLIC, anon;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.get_helper_earnings_export(uuid, date, date) TO authenticated, service_role;");
  });

  it("has a PGlite proof that is red on the old body", () => {
    const proof = resolve(ROOT, "src/test/pglite/earningsExportOneNet.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    expect(src).toContain(`const THIS = "${THIS}"`);
    expect(src).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["E1 a crew row's gross includes the urgent share", "E2 a single job's net is what was PAID", "E4 on every ledger row, gross - fee = net", "E5 a partial reversal later won", "E6 a crew member's partial reversal lost", "E7 a legacy crew lead", "const expected = 6;"]) {
      expect(src).toContain(c);
    }
  });
});
