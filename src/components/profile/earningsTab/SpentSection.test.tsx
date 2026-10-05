/**
 * Q1177: the Spent half of the Money tab. Ranges are PaymentTab's Spent
 * card's: lifetime / Monday-start week / calendar month / calendar year of
 * completed jobs this user POSTED, bucketed by the poster's confirmation, then
 * the helper's, then created_at. WHAT counts is posterSpend.ts (owner,
 * 2026-10-04, "Fix Spent first"): only real card charges, less refunds, gift
 * cover and chargebacks. The range fixture below is all plain paid jobs
 * (budget only, a PaymentIntent, released), so each charge equals its budget;
 * the "only real charges" test adds the jobs that must count less or nothing.
 *
 * Fixed clock: Sunday 2026-10-04, so this week began Monday 2026-09-28.
 *   p1 $30.00   poster-confirmed 2026-09-01  (year)
 *   p2 $20.50   poster-confirmed 2025-12-01  (lifetime only)
 *   p3 $10.00   helper-confirmed 2026-10-02  (week, month, year)
 *   p4 $5.00    no confirmation, created 2026-09-29 (week, year; month: no)
 *   Lifetime $65.50 · 4 jobs   Year $45.00 · 3   Month $10.00 · 1   Week $15.00 · 2
 */
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; | const diffToMonday = -dayOfWeek;
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const completedAt = j.poster_completed_at ?? j.helper_completed_at; | const completedAt = j.poster_completed_at;
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const rows = spentRows(scopedJobs, data?.refunds ?? [], data?.gifts ?? []); | const rows = spentRows(spentJobs, data?.refunds ?? [], data?.gifts ?? []);
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const rows = spentRows(scopedJobs, data?.refunds ?? [], data?.gifts ?? []); | const rows = spentRows(scopedJobs, [], data?.gifts ?? []);
// @mutate src/components/profile/earningsTab/SpentSection.tsx | {formatCents(cents)} | {formatCents(Math.round((j.budget ?? 0) * 100))}
// @mutate src/components/profile/earningsTab/SpentSection.tsx | .eq("status", "completed"), | .neq("status", "cancelled"),
// @mutate src/components/profile/earningsTab/SpentSection.tsx |         {isError ? ( |         {false ? (
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, profile: null, loading: false }),
}));

type Row = {
  id: string; title: string | null; budget: number; poster_completed_at: string | null; helper_completed_at: string | null; created_at: string;
  customer_fee_amount?: number | null; urgent_fee?: number | null; sales_tax_amount?: number | null;
  payment_status?: string | null; stripe_payment_intent_id?: string | null;
};
let rows: Row[];
let refundRows: { job_id: string; amount_cents: number }[] = [];
let giftRows: { job_id: string | null; amount: number }[] = [];
const paid = (r: Row): Row => ({ payment_status: "released", stripe_payment_intent_id: `pi_${r.id}`, ...r });
let filters: [string, string, unknown][] = [];
let failRead = false;

/** PostgREST stand-in for `.from("jobs").select(..).eq(..).eq(..)`, awaited. */
function builder(table: string) {
  const b: Record<string, unknown> = {};
  b.select = (cols: string) => { filters.push([table, "select", cols]); return b; };
  b.eq = (col: string, v: unknown) => { filters.push([table, col, v]); return b; };
  b.neq = (col: string, v: unknown) => { filters.push([table, `neq:${col}`, v]); return b; };
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      failRead ? { data: null, error: { message: "permission denied", code: "42501" } }
      : { data: table === "jobs" ? rows.map(paid) : table === "payment_refunds" ? refundRows : giftRows, error: null },
    ).then(resolve);
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => builder(t) },
}));

import { SpentSection } from "./SpentSection";

function renderSpent() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SpentSection />
    </QueryClientProvider>,
  );
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

describe("the Spent half of the Money tab (Q1177)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    // AnimatedCounter jumps straight to its value under reduced motion.
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"), media: q, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    filters = [];
    failRead = false;
    refundRows = [];
    giftRows = [];
    rows = [
      { id: "p1", title: "Gutter cleaning", budget: 30, poster_completed_at: "2026-09-01T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      { id: "p2", title: "Old fence", budget: 20.5, poster_completed_at: "2025-12-01T12:00:00", helper_completed_at: null, created_at: "2025-11-30T12:00:00" },
      { id: "p3", title: "Yard cleanup", budget: 10, poster_completed_at: null, helper_completed_at: "2026-10-02T12:00:00", created_at: "2026-09-20T12:00:00" },
      { id: "p4", title: null, budget: 5, poster_completed_at: null, helper_completed_at: null, created_at: "2026-09-29T12:00:00" },
    ];
  });
  afterEach(() => vi.useRealTimers());

  it("reads only completed jobs this user posted", async () => {
    renderSpent();
    await screen.findByText(/Total spent/);
    expect(filters).toContainEqual(["jobs", "customer_id", "user-1"]);
    expect(filters).toContainEqual(["jobs", "status", "completed"]);
    // The charge columns the rule reads, the poster's own refunds and their redeemed gifts.
    const jobCols = String(filters.find((f) => f[0] === "jobs" && f[1] === "select")?.[2]);
    for (const c of ["budget", "customer_fee_amount", "urgent_fee", "sales_tax_amount", "payment_status", "stripe_payment_intent_id"]) expect(jobCols).toContain(c);
    expect(filters).toContainEqual(["payment_refunds", "customer_id", "user-1"]);
    expect(filters).toContainEqual(["gift_cards", "recipient_id", "user-1"]);
    expect(filters).toContainEqual(["gift_cards", "status", "redeemed"]);
  });

  it("only real charges count: closed unpaid $0, full refund out, partial refund = kept, chargeback $0, gift part out, rows show the charge", async () => {
    rows = [
      { id: "c1", title: "Real paid job", budget: 40, customer_fee_amount: 4.8, poster_completed_at: "2026-09-01T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      { id: "c2", title: "Closed no payment", budget: 50, payment_status: "cancelled", stripe_payment_intent_id: null, poster_completed_at: "2026-09-02T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      { id: "c3", title: "Fully refunded", budget: 25, payment_status: "refunded", poster_completed_at: "2026-09-03T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      { id: "c4", title: "Partly refunded", budget: 60, poster_completed_at: "2026-09-04T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      { id: "c5", title: "Charged back", budget: 70, payment_status: "chargeback", poster_completed_at: "2026-09-05T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      { id: "c6", title: "Gift helped", budget: 30, poster_completed_at: "2026-09-06T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
    ];
    refundRows = [{ job_id: "c3", amount_cents: 2500 }, { job_id: "c4", amount_cents: 1500 }];
    giftRows = [{ job_id: "c6", amount: 20 }];
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$99\.80\s*across 3 jobs/));
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Gift helped", "Partly refunded", "Real paid job"]);
    expect(text()).toMatch(/Real paid job\s*Sep 1\s*\$44\.80/);
    expect(text()).toMatch(/Partly refunded\s*Sep 4\s*\$45\.00/);
    expect(text()).toMatch(/Gift helped\s*Sep 6\s*\$10\.00/);
    expect(text()).not.toMatch(/Closed no payment|Fully refunded|Charged back/);
  });

  it("same figures: lifetime, week, month and year totals and counts", async () => {
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$65\.50\s*across 4 jobs/));
    const pick = async (label: string) => {
      await act(async () => { fireEvent.click(screen.getByRole("radio", { name: label })); });
    };
    await pick("This Year");
    expect(text()).toMatch(/Total spent\s*\$45\.00\s*across 3 jobs/);
    await pick("This Month");
    expect(text()).toMatch(/Total spent\s*\$10\.00\s*across 1 job(?!s)/);
    await pick("This Week");
    expect(text()).toMatch(/Total spent\s*\$15\.00\s*across 2 jobs/);
    await pick("Lifetime");
    expect(text()).toMatch(/Total spent\s*\$65\.50\s*across 4 jobs/);
  });

  it("its range row is the same one-row, sideways-scrolling control as the Earned card's", async () => {
    renderSpent();
    const group = await screen.findByRole("radiogroup", { name: "Spend date range" });
    expect(group.className).toMatch(/overflow-x-auto/);
    expect(group.className).not.toMatch(/flex-wrap/);
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Lifetime", "This Week", "This Month", "This Year"]);
  });

  it("lists the jobs paid for in the selected range, newest first, each with its own amount", async () => {
    renderSpent();
    await screen.findByText("Jobs you paid for");
    const titles = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(titles).toEqual(["Yard cleanup", "Job", "Gutter cleaning", "Old fence"]);
    expect(text()).toMatch(/Gutter cleaning\s*Sep 1\s*\$30\.00/);
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "This Week" })); });
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Yard cleanup", "Job"]);
  });

  // lh-money-escrow review of Q1177: on the Spent half the figure is the whole
  // subject, so a refused read must say so, never print "$0.00 · no jobs yet".
  it("a failed read says it could not load, with a retry, and states no figure", async () => {
    failRead = true;
    renderSpent();
    await screen.findByText("We couldn't load what you've spent.");
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(text()).not.toMatch(/\$0\.00|no jobs yet|Jobs you paid for/);
  });

  it("no posted jobs: $0, no list, and the payment-methods note still shows", async () => {
    rows = [];
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$0\.00\s*no jobs yet/));
    expect(screen.queryByText("Jobs you paid for")).toBeNull();
    expect(screen.getByText(/Payment methods are managed securely through Stripe at checkout\./)).toBeTruthy();
  });
});
