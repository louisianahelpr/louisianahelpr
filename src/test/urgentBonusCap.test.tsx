/**
 * The urgent bonus is capped at $250 at EVERY layer (docs/OPEN.md Q210(c),
 * owner decision 2026-09-23). Before this the cap was the budget ceiling
 * ($1,000), so a single checkout could reach ~$2,000 + fees.
 *
 * One constant, MAX_URGENT_FEE_DOLLARS in supabase/functions/_shared/
 * jobBudgetLimits.ts, read back at each layer:
 *
 *   1. shared:  the constant is 250 and urgentFeeOverCap() refuses 250.01;
 *   2. client:  src/lib/moneyLimits.ts re-exports it; the posting form states
 *               the maximum from it and warns above it (rendered below); the
 *               submit validator (useJobSubmit) refuses above it;
 *   3. server:  create-payment refuses a checkout for an urgent job above it
 *               before any Checkout Session exists (behaviour proven in
 *               src/test/edge/create-payment.test.ts "refuses an urgent bonus of
 *               $250.01");
 *   4. DB:      the NEWEST migration adding jobs_urgent_fee_ceiling carries
 *               exactly the constant, and VALIDATEs it (history is checked, a
 *               violating row fails the migration loudly);
 *   5. seeds:   no fixture posts a bonus above it.
 *
 * There is no bonus EDIT surface: urgent_fee is in locked_everyone of the jobs
 * column-lock trigger, so the poster's INSERT is the only client write.
 *
 * Proven red 2026-09-23 on the unfixed state (origin/main bf4007bed:
 * MAX_URGENT_FEE_DOLLARS = MAX_JOB_BUDGET_DOLLARS, newest CHECK at 1000, no
 * create-payment refusal, no form maximum): 4 of 6 failed (shared, client form,
 * server, DB); the submit-validator and seed cases passed there because both
 * already read the constant, and go red under their @mutate lines instead.
 *
 * @mutate supabase/functions/_shared/jobBudgetLimits.ts | export const MAX_URGENT_FEE_DOLLARS = 250; | export const MAX_URGENT_FEE_DOLLARS = 1000;
 * @mutate supabase/migrations/20260923192217_urgent_bonus_cap_250.sql | CHECK (urgent_fee IS NULL OR (urgent_fee >= 0 AND urgent_fee <= 250)) NOT VALID; | CHECK (urgent_fee IS NULL OR (urgent_fee >= 0 AND urgent_fee <= 1000)) NOT VALID;
 * @mutate supabase/migrations/20260923192217_urgent_bonus_cap_250.sql |   ALTER TABLE public.jobs VALIDATE CONSTRAINT jobs_urgent_fee_ceiling; |   NULL;
 * @mutate supabase/functions/create-payment/index.ts | if (urgentFeeOverCap(job.is_urgent, job.urgent_fee)) { | if (false) {
 * @mutate src/pages/postjob/useJobSubmit.ts | if (isUrgent && parseFloat(urgentFee) > MAX_URGENT_FEE_DOLLARS) { | if (false) {
 * @mutate src/components/postjob/BudgetSection.tsx | const showUrgentMaxWarning = isUrgent && urgentFeeNum > MAX_URGENT_FEE_DOLLARS; | const showUrgentMaxWarning = false;
 * @mutate e2e/happy-path/seedDataHeavy.ts | urgent_fee: i % 5 === 0 ? 250 : null, | urgent_fee: i % 5 === 0 ? 1000 : null,
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import * as shared from "../../supabase/functions/_shared/jobBudgetLimits";
import * as client from "@/lib/moneyLimits";
import { BudgetSection } from "@/components/postjob/BudgetSection";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIGRATIONS = join(ROOT, "supabase/migrations");

/** Newest migration that ADDs jobs_urgent_fee_ceiling, comments blanked. */
function newestCeilingMigration(): { file: string; sql: string; checks: string[] } {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort().reverse();
  const re = /ADD\s+CONSTRAINT\s+jobs_urgent_fee_ceiling\s+CHECK\s*\(([\s\S]*?)\)\s*(?:NOT\s+VALID)?\s*;/gi;
  for (const f of files) {
    const sql = blankSqlComments(readFileSync(join(MIGRATIONS, f), "utf8"));
    const checks = [...sql.matchAll(re)].map((m) => m[1]);
    if (checks.length > 0) return { file: f, sql, checks };
  }
  throw new Error("no migration adds jobs_urgent_fee_ceiling");
}

function renderBudget(urgentFee: string) {
  const noop = () => {};
  render(
    <BudgetSection
      stepNumber={3}
      budget="100"
      setBudget={noop}
      suggested={null}
      budgetPresets={[]}
      priceStats={null}
      priceStatsLoading={false}
      isUrgent
      setIsUrgent={noop}
      urgentFee={urgentFee}
      setUrgentFee={noop}
      customUrgentFee
      setCustomUrgentFee={noop}
      budgetComplete
    />,
  );
}

describe("urgent bonus cap is $250 at every layer (Q210(c))", () => {
  it("shared: the constant is 250 and 250.01 is over it", () => {
    expect(shared.MAX_URGENT_FEE_DOLLARS).toBe(250);
    expect(shared.urgentFeeOverCap(true, 250)).toBe(false);
    expect(shared.urgentFeeOverCap(true, 250.01)).toBe(true);
    expect(shared.urgentFeeOverCap(true, "250.01")).toBe(true);
    expect(shared.urgentFeeOverCap(true, null)).toBe(false);
    // A non-urgent job is charged no bonus whatever the column holds.
    expect(shared.urgentFeeOverCap(false, 999)).toBe(false);
  });

  it("client: the form states the maximum and warns at 250.01, not at 250", () => {
    expect(client.MAX_URGENT_FEE_DOLLARS).toBe(shared.MAX_URGENT_FEE_DOLLARS);
    renderBudget("250");
    expect(screen.getByText(/\$5 minimum, \$250 maximum/i)).toBeTruthy();
    expect(screen.queryByText(/most an urgent bonus can be is \$250/)).toBeNull();
    document.body.innerHTML = "";
    renderBudget("250.01");
    expect(screen.getByText(/most an urgent bonus can be is \$250\./)).toBeTruthy();
  });

  it("client: the submit validator refuses a bonus above the constant", () => {
    const src = blankComments(read("src/pages/postjob/useJobSubmit.ts"));
    expect(src).toMatch(
      /if \(isUrgent && parseFloat\(urgentFee\) > MAX_URGENT_FEE_DOLLARS\) \{ toast\.error\([^;]*\); scrollToField\("custom-urgent-fee"\); return; \}/,
    );
  });

  it("server: create-payment refuses an over-cap bonus before any gift redemption or checkout", () => {
    const src = blankComments(read("supabase/functions/create-payment/index.ts"));
    const escrow = src.slice(src.indexOf('if (action === "escrow")'), src.indexOf('if (action === "release")'));
    const at = escrow.indexOf("if (urgentFeeOverCap(job.is_urgent, job.urgent_fee)) {");
    expect(at).toBeGreaterThan(0);
    expect(escrow.slice(at, at + 200)).toMatch(/throw new PublicError/);
    expect(at).toBeLessThan(escrow.indexOf("checkout.sessions.create"));
    // …and before a gift card is redeemed against budget + urgent_fee.
    expect(escrow.indexOf('rpc("redeem_gift_card"')).toBeGreaterThan(at);
  });

  it("DB: the newest jobs_urgent_fee_ceiling CHECK carries the constant and is VALIDATEd", () => {
    const { file, sql, checks } = newestCeilingMigration();
    const maxes = checks.flatMap((c) => [...c.matchAll(/urgent_fee\s*<=\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1])));
    expect(maxes.length, file).toBeGreaterThan(0);
    expect(new Set(maxes), file).toEqual(new Set([shared.MAX_URGENT_FEE_DOLLARS]));
    expect(sql, file).toMatch(/VALIDATE\s+CONSTRAINT\s+jobs_urgent_fee_ceiling/i);
    expect(sql, file).toMatch(/RAISE\s+EXCEPTION/i);
  });

  it("seeds: no fixture posts an urgent bonus above the cap", () => {
    const files = ["e2e/happy-path/seedDataHeavy.ts", "e2e/happy-path/seedData.ts", "scripts/audit/prod-seed.mjs"];
    let seen = 0;
    for (const f of files) {
      const src = blankComments(read(f));
      for (const m of src.matchAll(/\burgent_fee:\s*([^,\n]+)/g)) {
        for (const n of m[1].matchAll(/(?<![\w.])(\d+(?:\.\d+)?)(?![\w.])/g)) {
          const v = Number(n[1]);
          seen++;
          expect(v, `${f}: urgent_fee ${v}`).toBeLessThanOrEqual(shared.MAX_URGENT_FEE_DOLLARS);
        }
      }
    }
    expect(seen).toBeGreaterThan(2);
  });
});
