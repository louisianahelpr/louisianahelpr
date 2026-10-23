/**
 * Owner decision 2026-10-21 (top priority): every LEGACY job whose Helpr is
 * not paid yet moves to the flat Helpr fee, 5% + $0.70 (roadmap F3). The open
 * "GIVE AWAY!!" $60 job was stamped helper_fee_percent 12 ($52.80 take-home);
 * the owner's post promises $56.30.
 *
 * Migration 20261021142508 stamps such a job as create-payment stamps a flat
 * job at funding. Behaviour is executed in PGlite
 * (src/test/pglite/legacyJobsFlatFee.pglite.mjs: red before, green applied
 * 3x, each fee equal to the TypeScript jobFlatFeeTotalCents). This guard pins
 * the migration's stamp and its exclusions, and the cancel copy a restamped
 * job's poster sees (their checkout service fee is still kept on a cancel).
 *
 * @mutate supabase/migrations/20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql |      SET helper_fee_flat_cents = 70, |      SET helper_fee_flat_cents = 0,
 * @mutate supabase/migrations/20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql |      AND NOT COALESCE(j.is_group_job, false) |      AND true
 * @mutate supabase/migrations/20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql |      AND NOT EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = j.id); |      AND true;
 * @mutate supabase/migrations/20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql |      AND j.payment_status IN ('escrow', 'payout_pending', 'cancelling') |      AND j.payment_status IN ('escrow', 'payout_pending', 'cancelling', 'released')
 * @mutate supabase/migrations/20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql |      AND j.recurrence_days IS NULL |      AND true
 * @mutate src/lib/cancelRefundCopy.ts |   return !(Number(posterFee?.customer_fee_amount ?? 0) > 0); |   return true;
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";
import { migrationFiles } from "./helpers/effectiveFunctionDefs";
import { cancelRefundIsLessCardFee } from "@/lib/cancelRefundCopy";
import { jobFlatFeeTotalCents } from "../../supabase/functions/_shared/crewShares";

const ROOT = resolve(__dirname, "../..");
const DIR = resolve(ROOT, "supabase/migrations");
const THIS = "20261021142508_legacy_jobs_take_the_flat_helpr_fee.sql";
const squash = (s: string) => s.replace(/\s+/g, " ");

describe("legacy jobs whose Helpr is not paid take the flat 5% + $0.70 (owner 2026-10-21)", () => {
  const files = migrationFiles(DIR);
  const sql = squash(blankSqlComments(readFileSync(resolve(DIR, THIS), "utf8")));

  it("the migration exists and is the newest one that restamps legacy jobs", () => {
    expect(files).toContain(THIS);
    const restampers = files.filter((f) => /SET helper_fee_flat_cents = \d+,\s+helper_fee_percent = \d+/.test(blankSqlComments(readFileSync(resolve(DIR, f), "utf8"))));
    expect(restampers.length).toBeGreaterThan(0);
    expect(restampers[restampers.length - 1]).toBe(THIS);
  });

  it("stamps exactly create-payment's flat model: 70c, 5%, the flat fee on budget + bonus", () => {
    expect(sql).toContain("SET helper_fee_flat_cents = 70, helper_fee_percent = 5, platform_fee_amount = least(p.pay_cents, round(p.pay_cents * 5 / 100.0) + 70) / 100.0");
    expect(sql).toContain("round(COALESCE(x.budget, 0) * 100) + round(greatest(COALESCE(x.urgent_fee, 0), 0) * 100) AS pay_cents");
    // The owner's example: $60, no bonus -> $3.70 fee, $56.30 take-home.
    expect(jobFlatFeeTotalCents(6000, 0, 1)).toBe(370);
  });

  it("only legacy, funded, unpaid-out, one-off jobs with no payout yet", () => {
    for (const clause of [
      "AND j.helper_fee_flat_cents IS NULL",
      "AND j.poster_fee_flat_cents IS NULL",
      "AND j.payment_status IN ('escrow', 'payout_pending', 'cancelling')",
      "AND NOT COALESCE(j.is_group_job, false)",
      "AND j.recurrence_days IS NULL",
      "AND j.parent_job_id IS NULL",
      "AND NOT EXISTS (SELECT 1 FROM public.payout_transfers t WHERE t.job_id = j.id);",
    ]) {
      expect(sql, clause).toContain(clause);
    }
    // The poster side is never written.
    expect(sql).not.toMatch(/customer_fee_amount\s*=/);
  });

  it("the PGlite proof exists and names every case", () => {
    const proof = readFileSync(resolve(ROOT, "src/test/pglite/legacyJobsFlatFee.pglite.mjs"), "utf8");
    for (const c of ["L1 [fix]", "L2 [fix]", "L3 [fix]", "K1 [keep]", "K2 [keep]", "K3 [keep]", "K4 [keep]", "K5 [keep]", "K6 [keep]", "K7 [keep]", "K8 [keep]", "K9 [keep]", "RED as expected", "jobFlatFeeTotalCents"]) {
      expect(proof).toContain(c);
    }
  });
});

describe("the cancel copy of a restamped legacy job keeps naming its service fee", () => {
  it("a legacy job moved to the flat Helpr fee, whose poster paid a service fee: the service-fee copy", () => {
    expect(cancelRefundIsLessCardFee({ helper_fee_flat_cents: 70, helper_fee_percent: 5 }, { poster_fee_flat_cents: null, customer_fee_amount: 7.2 })).toBe(false);
  });
  it("a flat-model job funded at the job price only: refunded less the card fee", () => {
    expect(cancelRefundIsLessCardFee({ helper_fee_flat_cents: 70, helper_fee_percent: 5 }, { poster_fee_flat_cents: null, customer_fee_amount: 0 })).toBe(true);
  });
  it("a legacy job never restamped: the service-fee copy", () => {
    expect(cancelRefundIsLessCardFee({ helper_fee_flat_cents: null, helper_fee_percent: 12 }, { poster_fee_flat_cents: null, customer_fee_amount: 7.2 })).toBe(false);
  });
});
