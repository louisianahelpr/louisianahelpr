/**
 * Q1843 (owner decided 2026-10-21, MASTER-LIST): "urgent bonus TAXED like
 * labor." The urgent bonus is part of the job price (owner 2026-10-15), so on a
 * category whose labor Louisiana taxes, the bonus's Stripe line carries the
 * SAME tax code as the labor line; on an exempt category neither is taxed.
 *
 * Layers pinned here:
 *   - create-payment escrow (the REAL function through the edge harness): the
 *     "Urgent bonus" line's tax_code equals the labor line's, both ways, and
 *     the 3D Secure tax ceiling covers budget + bonus (a $200 + $61 assembly
 *     job reaches $300 only once the bonus's tax is counted);
 *   - jobEscrowTaxableBaseCents (the base the webhooks divide Stripe's tax by
 *     for jobs.sales_tax_rate): includes the CHARGED bonus (create-payment's
 *     $5 floor / cap) on a taxable category, never on an exempt one;
 *   - the Post-a-Task insert's locked sales_tax_amount taxes budget + bonus
 *     (src/pages/post-job/jobSubmitHelpers.test.ts).
 *
 * Red before: on origin/main 7f5f1ae900 the bonus line shipped
 * NONTAXABLE_TAX_CODE on every category.
 *
 * @mutate supabase/functions/create-payment/index.ts |               tax_code: laborTaxCode(job.category), // Q1843: taxed exactly like the labor line |               tax_code: NONTAXABLE_TAX_CODE,
 * @mutate supabase/functions/create-payment/index.ts |         + salesTaxCeilingCents(Math.round(job.budget * 100) + urgentFeeCents, job.category); |         + salesTaxCeilingCents(Math.round(job.budget * 100), job.category);
 * @mutate supabase/functions/_shared/salesTax.ts |   const taxedLaborCents = laborCents + urgentBonusChargedCents(job); |   const taxedLaborCents = laborCents;
 * @mutate supabase/functions/_shared/salesTax.ts |   return Math.min(Math.max(safe, URGENT_BONUS_FLOOR_CENTS), MAX_URGENT_FEE_DOLLARS * 100); |   return safe;
 */
import { beforeEach, describe, expect, it } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { resetEnv, setEnv } from "./mocks/deno-runtime";
import { PAYABLE_CONNECT_ACCOUNT, resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetSupabaseMock, scenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import {
  jobEscrowTaxableBaseCents,
  NONTAXABLE_TAX_CODE,
  TAXABLE_LABOR_TAX_CODE,
  urgentBonusChargedCents,
} from "../../../supabase/functions/_shared/salesTax";

const POSTER = { id: "poster-1", email: "poster@test.com" };
type Line = { price_data: { unit_amount: number; product_data: { name: string; tax_code?: string } } };

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc123",
  });
  return loadEdgeFunction("create-payment");
}

async function escrow(job: { category: string; budget: number; urgent_fee: number }) {
  scenario.authUser = POSTER;
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
  scenario.reads.jobs = {
    rows: [{
      id: "job-1", customer_id: POSTER.id, title: "Urgent job", payment_status: "unpaid",
      is_urgent: true, ...job,
    }],
  };
  scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true, subscription_tier: "pro" }] };
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" });
  const fn = await load();
  const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer t" }, body: { action: "escrow", jobId: "job-1" } }));
  expect(res.status).toBe(200);
  const args = stripeMock.checkout.sessions.create.mock.calls[0][0];
  const lines = args.line_items as Line[];
  const labor = lines.find((l) => l.price_data.product_data.name.startsWith("Helpr Job"));
  const bonus = lines.find((l) => l.price_data.product_data.name === "Urgent bonus");
  return { args, labor: labor!, bonus: bonus! };
}

describe("the urgent bonus is taxed like the labor (Q1843)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    stripeMock.accounts.retrieve.mockResolvedValue(PAYABLE_CONNECT_ACCOUNT);
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("taxable category (assembly): the bonus line carries the labor's taxable code", async () => {
    const { labor, bonus } = await escrow({ category: "assembly", budget: 100, urgent_fee: 20 });
    expect(bonus, "an urgent job has a bonus line").toBeTruthy();
    expect(bonus.price_data.unit_amount).toBe(2000);
    expect(labor.price_data.product_data.tax_code).toBe(TAXABLE_LABOR_TAX_CODE);
    expect(bonus.price_data.product_data.tax_code).toBe(TAXABLE_LABOR_TAX_CODE);
  });

  it("exempt category (cleaning): neither the labor nor the bonus is taxed", async () => {
    const { labor, bonus } = await escrow({ category: "cleaning", budget: 100, urgent_fee: 20 });
    expect(labor.price_data.product_data.tax_code).toBe(NONTAXABLE_TAX_CODE);
    expect(bonus.price_data.product_data.tax_code).toBe(NONTAXABLE_TAX_CODE);
  });

  it("3D Secure: the tax ceiling counts the bonus ($200 + $61 assembly reaches $300 only with the bonus's tax)", async () => {
    // lines 26,100c; ceiling 15% of 26,100 = 3,915 -> 30,015 (asks 3DS). On the budget alone: 3,000 -> 29,100.
    const { args } = await escrow({ category: "assembly", budget: 200, urgent_fee: 61 });
    expect(args.payment_method_options?.card?.request_three_d_secure).toBe("any");
  });

  it("and an exempt $200 + $61 job stays under $300 (no 3DS): the ceiling is tax, not the bonus itself", async () => {
    const { args } = await escrow({ category: "cleaning", budget: 200, urgent_fee: 61 });
    expect(args.payment_method_options?.card?.request_three_d_secure).toBeUndefined();
  });
});

describe("the taxed base the webhooks store sales_tax_rate over", () => {
  it("includes the charged bonus on a taxable category, never on an exempt one", () => {
    expect(jobEscrowTaxableBaseCents({ budget: 100, category: "assembly", is_urgent: true, urgent_fee: 20 })).toBe(12000);
    expect(jobEscrowTaxableBaseCents({ budget: 100, category: "assembly", is_urgent: false, urgent_fee: 20 })).toBe(10000);
    expect(jobEscrowTaxableBaseCents({ budget: 100, category: "cleaning", is_urgent: true, urgent_fee: 20 })).toBe(10000);
    expect(jobEscrowTaxableBaseCents({ budget: 100, category: "assembly" })).toBe(10000);
  });

  it("the charged bonus is create-payment's: $5 floor, the cap, none when not urgent", () => {
    expect(urgentBonusChargedCents({ is_urgent: true, urgent_fee: 0 })).toBe(500);
    expect(urgentBonusChargedCents({ is_urgent: true, urgent_fee: 2 })).toBe(500);
    expect(urgentBonusChargedCents({ is_urgent: true, urgent_fee: 40 })).toBe(4000);
    expect(urgentBonusChargedCents({ is_urgent: true, urgent_fee: 9999 })).toBe(25000);
    expect(urgentBonusChargedCents({ is_urgent: false, urgent_fee: 40 })).toBe(0);
    expect(urgentBonusChargedCents(null)).toBe(0);
  });
});
