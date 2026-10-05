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
// @mutate src/components/profile/earningsTab/SpentSection.tsx | : j.poster_completed_at ?? j.helper_completed_at; | : j.poster_completed_at;
// @mutate src/components/profile/earningsTab/SpentSection.tsx | ? j.cancelled_at | ? j.created_at
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const rows = since === null ? allRows : allRows.filter((r) => rowMs(r) >= since); | const rows = allRows;
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], data?.tips ?? []); | const allRows = spentRows(data?.jobs ?? [], [], data?.gifts ?? [], data?.tips ?? []);
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], data?.tips ?? []); | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], []);
// @mutate src/components/profile/earningsTab/SpentSection.tsx | {formatCents(r.cents)} | {formatCents(Math.round((r.job?.budget ?? 0) * 100))}
// @mutate src/components/profile/earningsTab/SpentSection.tsx | .eq("customer_id", posterId), | .eq("customer_id", posterId).eq("status", "completed"),
// @mutate src/components/profile/earningsTab/SpentSection.tsx | .eq("tipper_id", user!.id), | .eq("helper_id", user!.id),
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
  status?: string; cancelled_at?: string | null; cancellation_fee?: number | null; cancellation_fee_status?: string | null;
};
let rows: Row[];
let refundRows: { job_id: string; amount_cents: number }[] = [];
let giftRows: { job_id: string | null; amount: number }[] = [];
let tipRows: { id: string; job_id: string | null; amount: number; payment_status: string; stripe_payment_intent_id: string | null; created_at: string }[] = [];
const paid = (r: Row): Row => ({ status: "completed", cancelled_at: null, payment_status: "released", stripe_payment_intent_id: `pi_${r.id}`, ...r });
let filters: [string, string, unknown][] = [];
let failRead = false;

/** PostgREST stand-in for `.from("jobs").select(..).eq(..).eq(..)`, awaited. */
function builder(table: string) {
  const b: Record<string, unknown> = {};
  b.select = (cols: string) => { filters.push([table, "select", cols]); return b; };
  b.eq = (col: string, v: unknown) => { filters.push([table, col, v]); return b; };
  b.neq = (col: string, v: unknown) => { filters.push([table, `neq:${col}`, v]); return b; };
  b.in = (col: string, v: unknown) => { filters.push([table, `in:${col}`, v]); return b; };
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      failRead ? { data: null, error: { message: "permission denied", code: "42501" } }
      : { data: table === "jobs" ? rows.map(paid) : table === "payment_refunds" ? refundRows : table === "tips" ? tipRows : giftRows, error: null },
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
    tipRows = [];
    rows = [
      { id: "p1", title: "Gutter cleaning", budget: 30, poster_completed_at: "2026-09-01T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      { id: "p2", title: "Old fence", budget: 20.5, poster_completed_at: "2025-12-01T12:00:00", helper_completed_at: null, created_at: "2025-11-30T12:00:00" },
      { id: "p3", title: "Yard cleanup", budget: 10, poster_completed_at: null, helper_completed_at: "2026-10-02T12:00:00", created_at: "2026-09-20T12:00:00" },
      { id: "p4", title: null, budget: 5, poster_completed_at: null, helper_completed_at: null, created_at: "2026-09-29T12:00:00" },
    ];
  });
  afterEach(() => vi.useRealTimers());

  it("reads every job this user posted, with the charge columns, their refunds, gifts and paid tips", async () => {
    renderSpent();
    await screen.findByText(/Total spent/);
    expect(filters).toContainEqual(["jobs", "customer_id", "user-1"]);
    // No status filter: escrow held on an open job has left the card too.
    expect(filters.filter((f) => f[0] === "jobs" && /status/.test(f[1]))).toEqual([]);
    // The charge columns the rule reads, the poster's own refunds and their redeemed gifts.
    const jobCols = String(filters.find((f) => f[0] === "jobs" && f[1] === "select")?.[2]);
    for (const c of ["budget", "customer_fee_amount", "urgent_fee", "sales_tax_amount", "payment_status", "stripe_payment_intent_id", "cancellation_fee", "cancellation_fee_status", "cancelled_at", "status"]) expect(jobCols.split(/,\s*/)).toContain(c);
    const refundCols = String(filters.find((f) => f[0] === "payment_refunds" && f[1] === "select")?.[2]);
    for (const c of ["job_id", "amount_cents", "stripe_payment_intent_id"]) expect(refundCols.split(/,\s*/)).toContain(c);
    expect(filters).toContainEqual(["payment_refunds", "customer_id", "user-1"]);
    expect(filters).toContainEqual(["gift_cards", "recipient_id", "user-1"]);
    expect(filters).toContainEqual(["gift_cards", "status", "redeemed"]);
    // Tips this person PAID, never tips they received.
    expect(filters).toContainEqual(["tips", "tipper_id", "user-1"]);
  });

  it("money held on a job still under way counts (dated when posted); cancel_escrow's withheld fee counts", async () => {
    rows = [
      // Funded, Helpr working: the escrow left the card.
      { id: "w1", title: "In progress", budget: 80, customer_fee_amount: 9.6, status: "in_progress", payment_status: "escrow", poster_completed_at: null, helper_completed_at: null, created_at: "2026-09-29T12:00:00" },
      // Posted, never funded.
      { id: "w2", title: "Open unfunded", budget: 30, status: "open", payment_status: "unpaid", stripe_payment_intent_id: null, poster_completed_at: null, helper_completed_at: null, created_at: "2026-09-29T12:00:00" },
      // cancel_escrow: $50 + $6 captured, $50 refunded, ends payment_status 'cancelled'.
      { id: "w3", title: "Cancelled open", budget: 50, customer_fee_amount: 6, status: "cancelled", payment_status: "cancelled", cancelled_at: "2026-09-30T12:00:00", poster_completed_at: null, helper_completed_at: null, created_at: "2026-09-20T12:00:00" },
    ];
    refundRows = [{ job_id: "w3", amount_cents: 5000 }];
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$95\.60\s*across 2 jobs/));
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Cancelled open", "In progress"]);
    expect(text()).toMatch(/In progress\s*Sep 29\s*\$89\.60/);
    expect(text()).toMatch(/Cancelled open\s*Sep 30 · Cancelled\s*\$6\.00/);
    expect(text()).not.toMatch(/Open unfunded/);
  });

  it("tips and cancellation fees count (owner, 2026-10-05: everything that left the poster's card)", async () => {
    rows = [
      { id: "t1", title: "Tipped job", budget: 40, poster_completed_at: "2026-09-01T12:00:00", helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      // Cancelled late: $60 charged, refunded $45, so $15 was the fee kept.
      { id: "k1", title: "Cancelled late", budget: 60, status: "cancelled", payment_status: "refunded", cancellation_fee: 15, cancellation_fee_status: "charged", cancelled_at: "2026-10-02T12:00:00", poster_completed_at: null, helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
      // Cancelled free: hold voided.
      { id: "k2", title: "Cancelled free", budget: 70, status: "cancelled", payment_status: "cancelled", cancelled_at: "2026-10-03T12:00:00", poster_completed_at: null, helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
    ];
    refundRows = [{ job_id: "k1", amount_cents: 4500 }];
    tipRows = [
      { id: "tip1", job_id: "t1", amount: 8, payment_status: "paid", stripe_payment_intent_id: "pi_tip1", created_at: "2026-09-02T12:00:00" },
      { id: "tip2", job_id: "t1", amount: 5, payment_status: "failed", stripe_payment_intent_id: null, created_at: "2026-09-02T12:00:00" },
    ];
    renderSpent();
    // The $8 tip charged $8.55 (tip + card fee, tipChargeBreakdown).
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$63\.55\s*across 2 jobs/));
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Cancelled late", "Tipped job"]);
    expect(text()).toMatch(/Cancelled late\s*Oct 2 · Cancelled\s*\$15\.00/);
    expect(text()).toMatch(/Tipped job\s*Sep 1 · includes \$8\.55 tip\s*\$48\.55/);
    expect(text()).not.toMatch(/Cancelled free/);
    // The cancellation is dated when it was cancelled: inside this week's range.
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "This Week" })); });
    expect(text()).toMatch(/Total spent\s*\$15\.00\s*across 1 job(?!s)/);
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
