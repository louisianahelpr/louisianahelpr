/**
 * The "Confirm your next visit" card (Q210(b) $300+ on-session visits).
 *
 * Q749 (2): measured by the test-mode lane at 375/1440 on 2026-10-07, the card
 * printed the raw column, "on 2026-10-08", where every other job surface reads
 * "Thu, Oct 8" (formatJobDate). Q1247 (b): the query drops a series that is
 * over (the server refuses to take its payment) and uses the Louisiana date.
 *
 * @mutate src/pages/posts/postedJobs/RecurringVisitPayments.tsx | on {formatJobDate(row.visit_date)} is | on {row.visit_date} is
 * @mutate src/pages/posts/postedJobs/RecurringVisitPayments.tsx |           .gt("visit_date", today) |           .gt("visit_date", new Date().toISOString().slice(0, 10))
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Call = { op: string; args: unknown[] };
const calls = vi.hoisted(() => ({ list: [] as Call[], rows: [] as unknown[] }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gt", "is", "neq"]) {
    chain[op] = (...args: unknown[]) => {
      calls.list.push({ op, args });
      return chain;
    };
  }
  chain.order = (...args: unknown[]) => {
    calls.list.push({ op: "order", args });
    return Promise.resolve({ data: calls.rows, error: null });
  };
  return { supabase: { from: () => chain, functions: { invoke: vi.fn() } } };
});
vi.mock("@/lib/jobDate", () => ({ todayYmd: () => "2026-10-07" }));

import { RecurringVisitPayments } from "./RecurringVisitPayments";

const renderCard = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecurringVisitPayments userId="payer-1" />
    </QueryClientProvider>,
  );

describe("RecurringVisitPayments", () => {
  beforeEach(() => {
    calls.list = [];
    calls.rows = [
      { id: "vp-1", visit_date: "2026-10-08", amount_cents: 33600, parent_job_id: "p-1", jobs: { title: "Weekly yard" } },
    ];
  });

  it("Q749 (2): says the visit date the way every job surface does, never the raw column", async () => {
    renderCard();
    expect(await screen.findByText(/"Weekly yard" on Thu, Oct 8 is \$336\.00\./)).toBeInTheDocument();
    expect(screen.queryByText(/2026-10-08/)).toBeNull();
    expect(screen.getByRole("button", { name: /Pay \$336\.00/ })).toBeInTheDocument();
  });

  it("Q1247 (b): asks only for live series' visits after today's LOUISIANA date", async () => {
    renderCard();
    await screen.findByText(/Weekly yard/);
    const ops = calls.list.map((c) => `${c.op}:${JSON.stringify(c.args)}`);
    expect(ops).toContain('gt:["visit_date","2026-10-07"]');
    expect(ops).toContain('is:["jobs.series_ended_on",null]');
    expect(ops).toContain('neq:["jobs.status","cancelled"]');
  });

  it("renders nothing when no visit waits on payment", async () => {
    calls.rows = [];
    const { container } = renderCard();
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
  });
});
