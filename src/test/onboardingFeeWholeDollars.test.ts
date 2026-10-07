/**
 * Q1272 (1) (lh-money-escrow review of Q753): the setup fee is a whole dollar,
 * enforced by the database.
 *
 * A per-job preview computes floor(take-home - fee) like the server, while a
 * total computes sum(floor(take-home)) - fee (src/lib/firstPayoutFee.ts). The
 * two agree only while platform_settings.onboarding_fee_cents is a multiple of
 * 100. Migration 20261007045300 adds the CHECK; this guard reads it (and that
 * no later migration drops it).
 *
 * @mutate supabase/migrations/20261007045300_onboarding_fee_whole_dollars.sql | onboarding_fee_cents % 100 = 0 | onboarding_fee_cents % 1 = 0
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blankSqlComments } from "./helpers/blankNonCode";

const MIG = join(process.cwd(), "supabase/migrations");
const files = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const sql = (f: string) => blankSqlComments(readFileSync(join(MIG, f), "utf8"));

describe("Q1272 (1): onboarding_fee_cents is a whole number of dollars", () => {
  it("a migration adds the whole-dollar CHECK on platform_settings.onboarding_fee_cents", () => {
    const adds = files.filter((f) =>
      /ADD CONSTRAINT platform_settings_onboarding_fee_whole_dollars\s+CHECK \(onboarding_fee_cents IS NULL OR \(onboarding_fee_cents >= 0 AND onboarding_fee_cents % 100 = 0\)\)/.test(sql(f)));
    expect(adds.length).toBeGreaterThan(0);
  });

  it("no later migration drops it", () => {
    const drops = files.filter((f) => /DROP CONSTRAINT[^;]*platform_settings_onboarding_fee_whole_dollars/i.test(sql(f)));
    expect(drops).toEqual([]);
  });
});
