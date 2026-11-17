/**
 * Guard: the two cron sweeps that kept writing error_logs rows about SEED rows leave seed rows out of every
 * candidate query (owner rule: test or seed data never produces owner-facing alerts or error_logs noise).
 *
 * Measured on prod 2026-11-16 (read-only SQL):
 *   - declutter_handover_sweep logged "922732d4-... failed: order_not_paid" 14 times, about every 70 minutes: a
 *     seed porch order paid 7+ days ago with no booking and no PaymentIntent, which step (b) tried to close every
 *     run. Only step (f) left seed orders out (20261031004529).
 *   - sweep_disputes_closed_without_payment logged "Dispute c5c85b7e on job 7e52c767 ... moved no money"
 *     (source dispute-unsettled-seed, is_seed true), and four more seed disputes since 2026-10-20.
 * Fixed by 20261117041858. Behaviour proofs (PGlite, newest definitions, red with the exclusions removed):
 *   node src/test/pglite/declutterHandoverSweepClock.pglite.mjs     (SEED_SWEPT=1: 9 FAIL)
 *   node src/test/pglite/disputeSweepSkipsSeedJobs.pglite.mjs       (SEED_REPORTED=1: 3 FAIL)
 *
 * This reads the NEWEST effective definition of each (any dollar-quote tag, comments blanked) and requires the
 * seed exclusion in EVERY `FOR r IN SELECT ...` candidate query of the handover sweep, so a new step added
 * without it fails here.
 *
 * @mutate supabase/migrations/20261117041858_seed_rows_skip_handover_and_dispute_sweeps.sql |        AND o2.is_seed IS NOT TRUE\n     ORDER BY d.slot_start LIMIT 500 |      ORDER BY d.slot_start LIMIT 500
 * @mutate supabase/migrations/20261117041858_seed_rows_skip_handover_and_dispute_sweeps.sql |        AND j.is_seed IS NOT TRUE |        AND true
 */
import { describe, it, expect } from "vitest";
import { join, resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const defs = effectiveDefs(join(ROOT, "supabase", "migrations"));

const body = (name: string): string => {
  const def = defs.get(name);
  expect(def, `${name} must be defined by a migration`).toBeTruthy();
  return blankSqlComments(def!.stmt);
};

/** Each `FOR r IN <query> LOOP` candidate query in a plpgsql body. */
const candidateQueries = (src: string): string[] =>
  [...src.matchAll(/\bFOR\s+r\s+IN\b([\s\S]*?)\bLOOP\b/gi)].map((m) => m[1]).filter((qy) => /\bSELECT\b/i.test(qy));

describe("cron sweeps leave seed rows out (no error_logs noise about test data)", () => {
  it("declutter_handover_sweep: every candidate query excludes seed orders", () => {
    const queries = candidateQueries(body("declutter_handover_sweep"));
    // Inventory floor: steps (a), (b), (b2), (c), (d), (e), (f) as of 20261117041858.
    expect(queries.length).toBeGreaterThan(6);
    const missing = queries
      .map((qy, i) => ({ i, qy }))
      .filter(({ qy }) => !/\bo2\.is_seed\s+IS\s+NOT\s+TRUE\b/i.test(qy))
      .map(({ i, qy }) => `#${i + 1}: ${qy.replace(/\s+/g, " ").trim().slice(0, 160)}`);
    expect(missing, "a sweep step that reads a seed order fails on it every run and logs a defect").toEqual([]);
  });

  it("sweep_disputes_closed_without_payment: the candidate query excludes seed jobs", () => {
    const queries = candidateQueries(body("sweep_disputes_closed_without_payment"));
    expect(queries.length).toBeGreaterThan(0);
    for (const qy of queries) expect(qy).toMatch(/\bj\.is_seed\s+IS\s+NOT\s+TRUE\b/i);
  });
});
