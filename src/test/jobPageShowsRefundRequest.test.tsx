import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactElement } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

/**
 * Q2694 (Jobs stages audit 1102e row 6): the job page showed no open refund request on either side, because the
 * refund_requests switch was read only around the job lists. The page now draws the cards' own panel inside its own
 * switch read (PageRefundRequest), and JobPage renders it for the job's two parties.
 */

let latestRow: Record<string, unknown> | null = null;
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "limit"]) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve({ data: latestRow, error: null }));
  return { supabase: { ...chain, rpc: vi.fn() } };
});
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));
let switchOn = true;
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => switchOn }));

import { PageRefundRequest } from "@/pages/jobs/jobPage/PageRefundRequest";

const POSTER = "11111111-1111-4111-8111-111111111111";
const HELPR = "22222222-2222-4222-8222-222222222222";
const JOB = {
  id: "33333333-3333-4333-8333-333333333333", title: "Assemble a bookshelf", budget: 40, status: "completed",
  payment_status: "escrow", customer_id: POSTER, helper_id: HELPR, date_needed: jobLocalDateISO(-1), start_time: "10:00",
  helper_fee_percent: null, helper_fee_flat_cents: null, urgent_fee: 0,
};
const REQUEST = {
  id: "44444444-4444-4444-8444-444444444444", job_id: JOB.id, requester_id: POSTER, responder_id: HELPR,
  refund_scope: "part", amount_cents: 4000 / 2, budget_cents: 4000, reason: "Two shelves are still missing their back panel.",
  status: "open", answer_by: new Date(Date.now() + 23 * 3600e3).toISOString(), answered_at: null, dispute_id: null,
  created_at: new Date().toISOString(),
};

function wrap(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  latestRow = REQUEST;
  switchOn = true;
});

describe("the job page's refund request (Q2694)", () => {
  it("the Helpr asked reads the amount, the reason and the answer-by, with Answer", async () => {
    wrap(<PageRefundRequest job={JOB} userId={HELPR} otherName="Lexi Lombas" feeFallbackPercent={12} />);
    expect(await screen.findByText(/Two shelves are still missing their back panel/)).toBeInTheDocument();
    expect(screen.getByText("$20")).toBeInTheDocument();
    expect(screen.getByText(/Answer by/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Answer" })).toBeInTheDocument();
  });

  it("the poster who asked reads who has until when, and can withdraw", async () => {
    wrap(<PageRefundRequest job={JOB} userId={POSTER} otherName="Eli Reed" feeFallbackPercent={null} />);
    expect(await screen.findByText(/You asked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Withdraw request" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Answer" })).toBeNull();
  });

  it("is drawn as its own card on the page", async () => {
    wrap(<PageRefundRequest job={JOB} userId={HELPR} otherName="Lexi Lombas" feeFallbackPercent={12} />);
    await screen.findByText(/Two shelves/);
    expect(document.querySelector("[data-refund-request]")!.className.split(/\s+/)).toContain("rounded-2xl");
  });

  // No DOM at all: an empty box would keep the page's main column from collapsing (JobPage.test "no dead column").
  it("with the switch off the page draws nothing", () => {
    switchOn = false;
    const { container } = wrap(<PageRefundRequest job={JOB} userId={HELPR} otherName="Lexi Lombas" feeFallbackPercent={12} />);
    expect(container.childNodes.length).toBe(0);
  });

  // @mutate src/pages/jobs/jobPage/JobPage.tsx | <PageRefundRequest job={{ ...job, status: job.status ?? "" }} | <span data-x={job.id}
  it("JobPage renders it for the job's two parties", () => {
    const src = blankComments(readFileSync(join(__dirname, "..", "pages", "jobs", "jobPage", "JobPage.tsx"), "utf8"));
    expect(src).toMatch(/\{party && \(isPoster \|\| isHired\) && \(\s*<PageRefundRequest job=\{\{ \.\.\.job, status: job\.status \?\? "" \}\}/);
  });
});
