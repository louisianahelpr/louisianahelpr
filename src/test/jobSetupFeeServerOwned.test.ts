/**
 * Q1346: jobs.onboarding_fee_amount (the setup fee a job's checkout collected,
 * which Spent counts) is written only by the payment webhook. The newest
 * definitions of the two jobs column locks must keep it out of every client
 * seat: prevent_job_field_escalation lists it as locked for everyone, and
 * enforce_jobs_insert_column_lock clears it on a client INSERT.
 *
 * Behaviour (real Postgres, live trigger bodies): src/test/pglite/jobSetupFeeServerOwned.pglite.mjs
 * (6 PASS applied 3x; NEW_MIGRATION=skip -> 4 FAILED). Spent: src/lib/posterSpend.test.ts;
 * the stamp: src/test/edge/stripe-webhook.test.ts 'Q1346'.
 *
 * @mutate supabase/migrations/20261007140847_job_setup_fee_stamp.sql |     'has_active_dispute',\n | 'has_active_dispute'\n  ];\n  zz_unused CONSTANT text[] := ARRAY[\n
 * @mutate supabase/migrations/20261007140847_job_setup_fee_stamp.sql |   NEW.onboarding_fee_amount       := NULL;\n |
 * @mutate src/components/profile/earningsTab/SpentSection.tsx | sales_tax_amount, onboarding_fee_amount, payment_status, | sales_tax_amount, payment_status,
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const defs = effectiveDefs("supabase/migrations");
const body = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "").replace(/\s+/g, " ");

describe("Q1346: the job's setup-fee stamp is server-owned", () => {
  it("inventory: both locks are defined (floor)", () => {
    expect(body("prevent_job_field_escalation").length).toBeGreaterThan(1000);
    expect(body("enforce_jobs_insert_column_lock").length).toBeGreaterThan(1000);
  });

  it("an UPDATE from any client seat is refused (locked_everyone)", () => {
    const b = body("prevent_job_field_escalation");
    const list = /locked_everyone CONSTANT text\[\] := ARRAY\[([^\]]*)\]/.exec(b)?.[1] ?? "";
    expect(list).toMatch(/'onboarding_fee_amount'/);
  });

  it("a client INSERT cannot plant one", () => {
    expect(body("enforce_jobs_insert_column_lock")).toMatch(/NEW\.onboarding_fee_amount := NULL;/);
  });

  it("Spent reads the stamp (SpentSection's jobs select names it)", () => {
    const src = readFileSync("src/components/profile/earningsTab/SpentSection.tsx", "utf8");
    expect(src).toMatch(/\.select\("[^"]*\bonboarding_fee_amount\b[^"]*"\)/);
  });
});
