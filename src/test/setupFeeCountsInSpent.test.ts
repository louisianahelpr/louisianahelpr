/**
 * Q1346 (owner decision 2026-10-12): KEEP the $2 first-post setup fee, and the
 * poster's Spent total and receipts COUNT it.
 *
 * WHAT WAS WRONG: create-payment bills the one-time account setup fee as a line
 * item on the poster's first escrow checkout, but nothing on the job recorded
 * it, so Spent (src/lib/posterSpend.ts) and the Home History "what it cost"
 * record (src/lib/posterJobCost.ts) were $2 short on that job.
 *
 * Now: stripe-webhook stamps jobs.onboarding_fee_amount on the job whose
 * checkout KEPT the fee (edge tests in src/test/edge/stripe-webhook.test.ts;
 * create-payment's metadata amount equals the line item,
 * src/test/edge/create-payment.test.ts), the column is server-owned
 * (migration 20261012171259; PGlite proof
 * src/test/pglite/jobSetupFeeStamped.pglite.mjs), and posterPaidDollars adds
 * it, so every surface built on it (Spent rows and total, Home History) counts
 * it once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { posterPaidDollars } from "@/lib/posterJobCost";
import { posterSpentCents, spentRows, spentTotalCents, type PosterSpendJob } from "@/lib/posterSpend";
import { JOB_COLUMNS_AHEAD_OF_DB, JOB_READABLE_COLUMN_LIST } from "@/lib/jobColumns";
import { previewDisputeSplit } from "@/lib/disputeSplitPreview";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";

const ROOT = join(__dirname, "..", "..");
const job = (over: Partial<PosterSpendJob> = {}): PosterSpendJob => ({
  id: "j1",
  budget: 100,
  customer_fee_amount: 12,
  urgent_fee: null,
  sales_tax_amount: 0,
  payment_status: "released",
  stripe_payment_intent_id: "pi_1",
  ...over,
});

describe("Q1346: the $2 setup fee counts in Spent and the receipts", () => {
  it("posterPaidDollars (the one 'what it cost' number) adds the stamped fee", () => {
    expect(posterPaidDollars({ budget: 100, customer_fee_amount: 12, onboarding_fee_amount: 2 })).toBe(114);
    expect(posterPaidDollars({ budget: 100, customer_fee_amount: 12, onboarding_fee_amount: null })).toBe(112);
  });

  it("a paid first job's Spent row is the whole card charge, fee included", () => {
    const rows = spentRows([job({ onboarding_fee_amount: 2 }), job({ id: "j2", stripe_payment_intent_id: "pi_2" })], [], []);
    expect(rows.map((r) => r.cents)).toEqual([11400, 11200]);
    expect(spentTotalCents(rows)).toBe(22600);
  });

  it("a cancelled first job: cancel_escrow refunds the capture less the service fee, so the $2 came back too", () => {
    // Captured 114.00; refunded 114.00 - 12.00 service fee = 102.00.
    expect(posterSpentCents(job({ onboarding_fee_amount: 2, payment_status: "refunded" }), 10200, 0)).toBe(1200);
    // A full refund (whole PaymentIntent) leaves nothing.
    expect(posterSpentCents(job({ onboarding_fee_amount: 2, payment_status: "refunded" }), 11400, 0)).toBe(0);
  });

  it("the admin dispute preview splits the same capture the executor does (pi.amount_received includes the fee)", () => {
    const base = { budget: 10, customer_fee_amount: 1.2, urgent_fee: 0, sales_tax_amount: 0, helper_fee_percent: 12 };
    const without = previewDisputeSplit(base as never, 0, "free");
    const withFee = previewDisputeSplit({ ...base, onboarding_fee_amount: 2 } as never, 0, "free");
    expect(without.posterGross).toBe(11.2);
    expect(withFee.posterGross).toBe(13.2);
    const admin = blankComments(readFileSync(join(ROOT, "src/components/admin/AdminDisputes.tsx"), "utf8"));
    expect(admin.match(/readJobsAheadOfDb\(\s*"[^"]*sales_tax_amount, onboarding_fee_amount, is_seed/g)?.length).toBe(3);
  });

  it("the Money tab and Home History read the column, deploy-safe (a read before db-deploy retries without it)", () => {
    // NOT in the shared readable list: a column there that the web app selects
    // before db-deploy adds it 42703s every jobs read in the app (jobColumns.ts).
    expect(JOB_READABLE_COLUMN_LIST).not.toContain("onboarding_fee_amount");
    expect(JOB_COLUMNS_AHEAD_OF_DB).toContain("onboarding_fee_amount");
    const spent = blankComments(readFileSync(join(ROOT, "src/components/profile/earningsTab/SpentSection.tsx"), "utf8"));
    expect(spent.length).toBeGreaterThan(1000);
    expect(spent).toMatch(/readJobsAheadOfDb\(\s*"[^"]*\bonboarding_fee_amount\b[^"]*",\s*\(columns\) => supabase\.from\("jobs"\)\.select\(columns\)/);
    const history = blankComments(readFileSync(join(ROOT, "src/pages/profile/HomeHistory.tsx"), "utf8"));
    expect(history).toMatch(/readJobsAheadOfDb\(`\$\{JOB_READABLE_COLUMNS\}, onboarding_fee_amount`/);
    expect(history).toContain("posterPaidDollars(");
  });

  it("the column exists and is server-owned (cleared on a client INSERT, refused on a client UPDATE)", () => {
    const sql = blankSqlComments(readFileSync(join(ROOT, "supabase/migrations/20261012171259_job_setup_fee_stamped.sql"), "utf8"));
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS onboarding_fee_amount numeric/);
    expect(sql).toMatch(/NEW\.onboarding_fee_amount := NULL;/);
    expect(sql).toMatch(/NEW\.onboarding_fee_amount IS DISTINCT FROM OLD\.onboarding_fee_amount THEN\s+RAISE EXCEPTION/);
    expect(sql).toMatch(/CREATE TRIGGER trg_onboarding_fee_server_owned\s+BEFORE INSERT OR UPDATE ON public\.jobs/);
    expect(sql).toMatch(/PERFORM public\.sync_jobs_select_grants\(\);/);
    // The two jobs that kept the fee before the stamp existed (live Stripe, 2026-10-12).
    expect(sql).toMatch(/SET onboarding_fee_amount = 2\.00\s+WHERE id IN \('4d7f3085-a572-48c4-8c5a-a29ddf0e38ea', '1e16c281-e9fc-4d9a-9380-1ecefdac8932'\)\s+AND onboarding_fee_amount IS NULL;/);
  });
});

// @mutate src/lib/posterJobCost.ts |     num(job.sales_tax_amount) +\n    num(job.onboarding_fee_amount) |     num(job.sales_tax_amount)
// @mutate src/lib/jobColumns.ts | export const JOB_COLUMNS_AHEAD_OF_DB = ["materials_note", "onboarding_fee_amount"] as const; | export const JOB_COLUMNS_AHEAD_OF_DB = ["materials_note"] as const;
// @mutate src/pages/profile/HomeHistory.tsx | readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}, onboarding_fee_amount`, | readJobsAheadOfDb(`${JOB_READABLE_COLUMNS}`,
// @mutate src/components/profile/earningsTab/SpentSection.tsx | sales_tax_amount, onboarding_fee_amount, payment_status | sales_tax_amount, payment_status
// @mutate supabase/migrations/20261012171259_job_setup_fee_stamped.sql |     NEW.onboarding_fee_amount := NULL; |     NULL;
// @mutate src/lib/disputeSplitPreview.ts |     (job.onboarding_fee_amount ?? 0); |     0;
