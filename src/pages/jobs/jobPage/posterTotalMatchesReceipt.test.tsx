/**
 * F109 (owner UI audit 2026-11-09, /jobs/28f8cff5…: the job said $10, Receipts said $11.20 for the same job, with no
 * breakdown on the job page): the poster's page says the total the card was charged and what it is made of, from
 * the same stamped columns Receipts adds up (posterPaidDollars), with the checkout's row names. Measured on prod
 * 2026-11-09: that job is budget 10.00 + customer_fee_amount 1.2 (the service fee), so "Total $11.20 ($10 job +
 * $1.20 service fee)". The job page's read asks for those columns (inventory: every PosterChargedJob column).
 * @mutate src/pages/jobs/jobPage/JobPageParts.tsx |   const totalLine = posterTotalLine(job); |   const totalLine = null;
 * @mutate src/lib/posterJobCost.ts |   return `Total ${usd(posterPaidDollars(job))} (${named.join(" + ")})`; |   return `Total ${usd(num(job.budget))} (${named.join(" + ")})`;
 * @mutate src/pages/jobs/jobPage/useJobPage.ts | , customer_fee_amount, sales_tax_amount, onboarding_fee_amount"; | ";
 * @mutate src/pages/jobs/jobPage/useJobPage.ts |     customer_fee_amount: raw.customer_fee_amount == null ? null : Number(raw.customer_fee_amount), |     customer_fee_amount: raw.customer_fee_amount as number \| null,
 */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { JobPageRow } from "./useJobPage";
import { posterPaidDollars, posterTotalLine } from "@/lib/posterJobCost";

vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "p" }, profile: null }) }));
vi.mock("@/hooks/useJobRescheduled", () => ({ useJobRescheduled: () => false }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: vi.fn(async () => ({ data: [{ user_id: "h", full_name: "Lexi Lombas", is_payout_ready: true, is_id_verified: true }], error: null })) },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
vi.mock("@/hooks/usePosterJobRefund", () => ({ usePosterJobRefund: () => null }));

import { PosterMoneyNotes } from "./JobPageParts";

const row = (over: Partial<JobPageRow>): JobPageRow => ({
  id: "j", title: "Mow a quarter-acre lawn", description: null, category: "yard_work", budget: 10, date_needed: null, start_time: null,
  is_flexible_schedule: false, location: null, customer_id: "p", helper_id: "h", status: "completed", payment_status: "released",
  urgent_fee: 0, helpers_needed: 1, is_group_job: false, photos: [], helper_fee_flat_cents: 70, helper_fee_percent: 5, poster_fee_flat_cents: null,
  ...over,
});
const total = () => document.querySelector("[data-poster-total]")?.textContent ?? null;

describe("F109: the job page says the total Receipts shows", () => {
  it("the audited job: $10 + $1.20 service fee reads 'Total $11.20 ($10 job + $1.20 service fee)'", () => {
    render(<MemoryRouter><PosterMoneyNotes job={row({ customer_fee_amount: 1.2, sales_tax_amount: 0, onboarding_fee_amount: null })} total={0} loading={false} /></MemoryRouter>);
    expect(total()).toBe("Total $11.20 ($10 job + $1.20 service fee)");
  });

  it("every charged part is named, and the total is posterPaidDollars (what Receipts adds up)", () => {
    const job = { budget: 100, customer_fee_amount: 5.7, urgent_fee: 10, sales_tax_amount: 9.45, onboarding_fee_amount: 2 };
    expect(posterPaidDollars(job)).toBeCloseTo(127.15, 2);
    expect(posterTotalLine(job)).toBe("Total $127.15 ($100 job + $5.70 service fee + $10 urgent bonus + $9.45 sales tax + $2 one-time account setup)");
  });

  it("a job charged exactly its price shows no total line", () => {
    render(<MemoryRouter><PosterMoneyNotes job={row({ customer_fee_amount: 0, sales_tax_amount: 0, onboarding_fee_amount: null })} total={0} loading={false} /></MemoryRouter>);
    expect(total()).toBeNull();
    expect(posterTotalLine({ budget: 40 })).toBeNull();
  });

  it("the job page reads every charge column, as numbers (they arrive as strings)", () => {
    const src = readFileSync("src/pages/jobs/jobPage/useJobPage.ts", "utf8");
    const party = src.match(/const PARTY_COLUMNS =\s*"([^"]+)"/)?.[1] ?? "";
    const cols = ["budget", "customer_fee_amount", "urgent_fee", "sales_tax_amount", "onboarding_fee_amount"];
    expect(cols.length).toBeGreaterThan(4);
    for (const c of cols) {
      expect(party.split(/,\s*/), c).toContain(c);
      expect(src, c).toMatch(new RegExp(`${c}: (raw\\.${c} == null \\? null : )?Number\\(raw\\.${c}`));
    }
  });
});
