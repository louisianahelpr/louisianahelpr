/**
 * Q1390 (owner 2026-10-07, option (a)): a poster who blocks a committed crew
 * member close to the start owes that member a fee, paid from the job's
 * escrow at settlement; the spot stays closed; the fee is on a ledger
 * reconciliation reads.
 *
 * Behaviour (block, closed spot, no reuse of its slot, repeat block, the
 * all-closed alert): src/test/pglite/crewBlockFeeLedger.pglite.mjs
 * (--before: RED 8/8; after, applied 3x: ALL PASS). Payment: the Q1390 cases
 * in src/test/edge/process-scheduled-payouts-crew.test.ts and
 * void-cancelled-payments-crew.test.ts; reconciliation:
 * money-reconciliation-fee-ledger.test.ts. This file pins the newest
 * definitions, so a later restatement cannot drop a layer silently.
 *
 * @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |                               - (SELECT count(*)::int FROM public.crew_block_fees b WHERE b.job_id = j.id)) |                               )
 * @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |      AND NOT EXISTS (SELECT 1 FROM public.crew_block_fees b WHERE b.job_id = v_job_id AND b.slot_no = s); |      AND true;
 * @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql |         ON CONFLICT (job_id, slot_no) DO NOTHING; |         ;
 * @mutate supabase/migrations/20261007113957_booked_job_detail_change_request.sql |   v_out := v_out \|\| jsonb_build_object('crew_block_fees', |   v_out := v_out \|\| jsonb_build_object('crew_block_fees_x',
 * @mutate supabase/migrations/20261007073145_crew_block_fee_ledger.sql | - (SELECT count(*)::integer AS count FROM crew_block_fees b WHERE b.job_id = jobs.id)) ELSE 0 END) > 0)) | ) ELSE 0 END) > 0))
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { readdirSync } from "./helpers/trackedFiles";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";

const root = resolve(__dirname, "../..");
const DIR = resolve(root, "supabase/migrations");
const THIS = "20261007073145_crew_block_fee_ledger.sql";
const EFFECTIVE = effectiveDefs(DIR);
const body = (fn: string) => blankSqlComments(EFFECTIVE.get(fn)?.stmt ?? "");
const migration = blankSqlComments(readFileSync(resolve(DIR, THIS), "utf8"));

/** The newest CREATE OR REPLACE VIEW public.open_jobs_browse, comments blanked. */
function newestBrowseView(): { file: string; sql: string } {
  let found = { file: "", sql: "" };
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = blankSqlComments(readFileSync(resolve(DIR, f), "utf8"));
    const i = sql.lastIndexOf("CREATE OR REPLACE VIEW public.open_jobs_browse");
    if (i >= 0) found = { file: f, sql: sql.slice(i, sql.indexOf("$v$", i)) };
  }
  return found;
}

describe("a crew block fee is a ledger row and its spot stays closed (Q1390)", () => {
  it("the ledger is server-only: RLS on, no client grant, one row per closed slot", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.crew_block_fees/);
    expect(migration).toMatch(/ALTER TABLE public\.crew_block_fees ENABLE ROW LEVEL SECURITY;/);
    expect(migration).toMatch(/REVOKE ALL ON public\.crew_block_fees FROM PUBLIC, anon, authenticated;/);
    expect(migration).not.toMatch(/GRANT[^;]*ON public\.crew_block_fees TO[^;]*\b(anon|authenticated)\b/);
    expect(migration).toMatch(/CONSTRAINT crew_block_fees_one_per_slot UNIQUE \(job_id, slot_no\)/);
    expect(migration).toMatch(/helper_id\s+uuid REFERENCES auth\.users\(id\) ON DELETE SET NULL/);
  });

  it("block_user_and_settle writes the fee to the ledger (never twice), not the by-hand alert", () => {
    expect(EFFECTIVE.get("block_user_and_settle")?.file).toBe(THIS);
    const b = body("block_user_and_settle");
    expect(b).toMatch(/IF v_member_fee > 0 AND v_crew\.slot_no IS NOT NULL THEN\s+INSERT INTO public\.crew_block_fees \(job_id, helper_id, slot_no, share_basis_cents, fee_percent, fee_cents\)[\s\S]{0,300}ON CONFLICT \(job_id, slot_no\) DO NOTHING;/);
    // The by-hand alert is left only for a slotless legacy row (Q1380).
    expect(b).toMatch(/ELSIF v_member_fee > 0 THEN\s+INSERT INTO public\.notifications[\s\S]{0,300}'Crew block: fee owed by hand'/);
  });

  it("every spot count treats a closed spot as taken, and no hire reuses its slot", () => {
    expect(EFFECTIVE.get("crew_spots_open")?.file).toBe(THIS);
    expect(body("crew_spots_open")).toMatch(/- \(SELECT count\(\*\)::int FROM public\.crew_block_fees b WHERE b\.job_id = j\.id\)\)/);
    expect(EFFECTIVE.get("accept_group_application")?.file).toBe(THIS);
    const a = body("accept_group_application");
    expect(a).toMatch(/v_current := v_current \+ \(SELECT count\(\*\)::int FROM public\.crew_block_fees b WHERE b\.job_id = v_job_id\);\s+IF v_current >= v_needed THEN\s+RAISE EXCEPTION 'roster_full';/);
    expect(a).toMatch(/AND NOT EXISTS \(SELECT 1 FROM public\.crew_block_fees b WHERE b\.job_id = v_job_id AND b\.slot_no = s\);/);
    const view = newestBrowseView();
    expect(view.file).toBe(THIS);
    // Both inline copies of the spot count (the column and the WHERE).
    expect(view.sql.match(/- \(SELECT count\(\*\)::integer AS count FROM crew_block_fees b WHERE b\.job_id = jobs\.id\)\)/g) ?? []).toHaveLength(2);
    expect(view.sql).toMatch(/WITH \(security_invoker = false\)/);
  });

  it("the member gets the row in their data export (the poster is told by notification)", () => {
    // This migration or a later restatement (Q1254, 20261007113957) that keeps the section.
    expect((EFFECTIVE.get("export_my_data")?.file ?? "") >= THIS).toBe(true);
    expect(body("export_my_data")).toMatch(/jsonb_build_object\('crew_block_fees', \(SELECT coalesce\(jsonb_agg\(to_jsonb\(t\)\), '\[\]'::jsonb\) FROM public\.crew_block_fees t\s+WHERE t\.helper_id = v_uid\)\)/);
  });

  it("the PGlite proof exists and names every case", () => {
    const proof = resolve(root, "src/test/pglite/crewBlockFeeLedger.pglite.mjs");
    expect(existsSync(proof)).toBe(true);
    const src = readFileSync(proof, "utf8");
    expect(src).toContain("effectiveDefs(DIR, { before: THIS })");
    for (const c of ["F1 a block 10h out", "F2 a repeat block", "F3 a booked crew with a closed spot", "F4 the next hire takes a free slot", "F5 a block three days out", "F6 every spot closed", "RED as expected"]) {
      expect(src).toContain(c);
    }
  });

  it("both settlement paths try the ledger and withhold it from the refund, through one shared payer; Part F sweeps the rest", () => {
    const psp = readFileSync(resolve(root, "supabase/functions/process-scheduled-payouts/index.ts"), "utf8");
    const vcp = readFileSync(resolve(root, "supabase/functions/void-cancelled-payments/index.ts"), "utf8");
    expect(psp).toMatch(/payCrewBlockFees\([\s\S]{0,200}\);\s+for \(const p of paidFees\.problems\) jobDefect\(job\.id, p\);\s+\}\s+const refund = await refundUnfilledCrewShares\(\{ \.\.\.a, paidCents, blockFeeCents: crewBlockFeeCents\(blockFees\.rows\) \}\);/);
    expect(psp).toMatch(/const unfilledCents = unpaidBudgetCents - blockFeeCents \+ Math\.max\(0, urgentCents - paidUrgent\);/);
    expect(vcp).toMatch(/await payBlockFees\(pi\);\s+const blockFeeCents = crewBlockFeeCents\(blockFeeRows\);\s+const refundAmount = capturedCents - Math\.round\(cancellationFee \* 100\) - blockFeeCents - nonRefundableCents;/);
    // Part F: a fee still owed on a settled job is retried every run.
    expect(vcp).toMatch(/\.from\("crew_block_fees"\)[\s\S]{0,200}\.in\("status", \["owed", "failed"\]\)/);
    // The ghost-transfer guard knows a block fee is this loop's own (HIGH, lh-money-escrow review).
    expect(vcp).toMatch(/t\.metadata\?\.type !== "cancellation_fee" && t\.metadata\?\.type !== "crew_block_fee"/);
    const shared = readFileSync(resolve(root, "supabase/functions/_shared/crewBlockFees.ts"), "utf8");
    expect(shared).toMatch(/idempotencyKey: `crew-block-fee-\$\{row\.id\}`/);
  });
});
