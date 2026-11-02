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
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], data?.tips ?? [], data?.blockFees ?? []); | const allRows = spentRows(data?.jobs ?? [], [], data?.gifts ?? [], data?.tips ?? [], data?.blockFees ?? []);
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], data?.tips ?? [], data?.blockFees ?? []); | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], [], data?.blockFees ?? []);
// Q1736: the crew block fees an uncaptured hold's capture took.
// @mutate src/components/profile/earningsTab/SpentSection.tsx | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], data?.tips ?? [], data?.blockFees ?? []); | const allRows = spentRows(data?.jobs ?? [], data?.refunds ?? [], data?.gifts ?? [], data?.tips ?? []);
// @mutate src/components/profile/earningsTab/usePosterSpendData.ts | blockFees: blockFees.error?.code === "PGRST202" ? [] : ((unwrap(blockFees) ?? []) as PosterBlockFeeRow[]), | blockFees: (unwrap(blockFees) ?? []) as PosterBlockFeeRow[],
// @mutate src/components/profile/earningsTab/SpentSection.tsx | {formatCents(r.cents)} | {formatCents(Math.round((r.job?.budget ?? 0) * 100))}
// @mutate src/components/profile/earningsTab/usePosterSpendData.ts | supabase.from("jobs").select(columns).eq("customer_id", posterId), | supabase.from("jobs").select(columns).eq("customer_id", posterId).eq("status", "completed"),
// @mutate src/components/profile/earningsTab/usePosterSpendData.ts | .eq("tipper_id", posterId), | .eq("helper_id", posterId),
// @mutate src/components/profile/earningsTab/SpentSection.tsx |         {isError ? ( |         {false ? (
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

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
/** poster_crew_block_fee_cents (Q1736): the answer, or the error it returns. */
let blockFeeResult: { data: { job_id: string; fee_cents: number }[] | null; error: { message: string; code: string } | null } = { data: [], error: null };
let rpcCalls: string[] = [];
/** A3-112: the buyer's own paid Declutter orders and their lines. */
let orderRows: { id: string; status: string; total_cents: number; paid_at: string | null }[] = [];
let lineRows: { order_id: string; item_title: string }[] = [];
let paidRows: { order_id: string; paid_cents: number }[] = [];
let failPaid = false;
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
  b.not = (col: string, op: string, v: unknown) => { filters.push([table, `not:${col}:${op}`, v]); return b; };
  b.order = () => b;
  b.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(
      failRead ? { data: null, error: { message: "permission denied", code: "42501" } }
      : { data: table === "jobs" ? rows.map(paid) : table === "payment_refunds" ? refundRows : table === "tips" ? tipRows
          : table === "declutter_orders" ? orderRows : table === "declutter_cart_items" ? lineRows : giftRows, error: null },
    ).then(resolve);
  return b;
}
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t),
    rpc: (fn: string) => {
      rpcCalls.push(fn);
      return Promise.resolve(failRead ? { data: null, error: { message: "permission denied", code: "42501" } }
        : fn === "declutter_my_paid_cents" ? (failPaid ? { data: null, error: { message: "boom", code: "XX000" } } : { data: paidRows, error: null }) : blockFeeResult);
    },
  },
}));

import { SpentSection } from "./SpentSection";

function renderSpent() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SpentSection /></MemoryRouter>
    </QueryClientProvider>,
  );
}

const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

// @mutate src/components/profile/earningsTab/SpentSection.tsx | ` · includes ${formatCents(r.tipGivenCents)} tip` | ` · includes ${formatCents(r.tipCents)} tip`
// @mutate src/components/profile/earningsTab/SpentSection.tsx |                   {refundedReceiptNote(r)}\n |
// @mutate src/lib/posterSpend.ts |   return r.job && r.refundedCents > 0 ? ` · $${(r.refundedCents / 100).toFixed(2)} refunded` : ""; |   return "";
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
    blockFeeResult = { data: [], error: null };
    rpcCalls = [];
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
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$95\.60\s*2 jobs/));
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Cancelled open", "In progress"]);
    expect(text()).toMatch(/In progress\s*Sep 29 · Held until the job is approved\s*\$89\.60/);
    expect(text()).toMatch(/Cancelled open\s*Sep 30 · Cancelled · \$50\.00 refunded\s*\$6\.00/);
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
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$63\.55\s*2 jobs/));
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Cancelled late", "Tipped job"]);
    expect(text()).toMatch(/Cancelled late\s*Oct 2 · Cancelled · \$45\.00 refunded\s*\$15\.00/);
    // AUD31-55: the row names the tip given ($8), never the tip's charge ($8.55) as the tip; the amount is unchanged.
    expect(text()).toMatch(/Tipped job\s*Sep 1 · includes \$8\.00 tip\s*\$48\.55/);
    expect(text()).not.toMatch(/Cancelled free/);
    // The cancellation is dated when it was cancelled: inside this week's range.
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "This week" })); });
    expect(text()).toMatch(/Total spent\s*\$15\.00\s*1 job(?!s)/);
  });

  it("Q1736: a crew whose uncaptured hold paid the cancellation fee AND block fees counts both", async () => {
    rows = [
      // $200 crew hold; void-cancelled-payments captured the $30 fee + $25 of block fees, no refund row.
      { id: "c1", title: "Crew move", budget: 200, status: "cancelled", payment_status: "refunded", cancellation_fee: 30, cancellation_fee_status: "charged", cancelled_at: "2026-10-02T12:00:00", poster_completed_at: null, helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
    ];
    blockFeeResult = { data: [{ job_id: "c1", fee_cents: 2500 }], error: null };
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$55\.00\s*1 job(?!s)/));
    expect(rpcCalls).toEqual(["poster_crew_block_fee_cents"]);
  });

  it("Q1736: before the RPC is deployed (PGRST202) Spent still loads, with the cancellation fee alone", async () => {
    rows = [
      { id: "c1", title: "Crew move", budget: 200, status: "cancelled", payment_status: "refunded", cancellation_fee: 30, cancellation_fee_status: "charged", cancelled_at: "2026-10-02T12:00:00", poster_completed_at: null, helper_completed_at: null, created_at: "2026-08-30T12:00:00" },
    ];
    blockFeeResult = { data: null, error: { message: "Could not find the function", code: "PGRST202" } };
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$30\.00\s*1 job(?!s)/));
  });

  it("only real charges count: closed unpaid $0, full refund listed at $0 (AUD31-55), partial refund = kept, chargeback $0, gift part out, rows show the charge", async () => {
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
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$99\.80\s*4 jobs/));
    expect(screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent)).toEqual(["Gift helped", "Partly refunded", "Fully refunded", "Real paid job"]);
    // AUD31-55 (lead decision 10-31): a job refunded in full stays, at $0 net; the total ($99.80) is the sum of the rows.
    expect(text()).toMatch(/Fully refunded\s*Sep 3 · Refunded in full\s*\$0\.00/);
    expect(text()).toMatch(/Real paid job\s*Sep 1\s*\$44\.80/);
    // AUD31-55: a partial refund says what came back.
    expect(text()).toMatch(/Partly refunded\s*Sep 4 · \$15\.00 refunded\s*\$45\.00/);
    expect(text()).toMatch(/Gift helped\s*Sep 6\s*\$10\.00/);
    expect(text()).not.toMatch(/Closed no payment|Charged back/);
  });

  it("same figures: lifetime, week, month and year totals and counts", async () => {
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$65\.50\s*4 jobs/));
    const pick = async (label: string) => {
      await act(async () => { fireEvent.click(screen.getByRole("radio", { name: label })); });
    };
    await pick("This year");
    expect(text()).toMatch(/Total spent\s*\$45\.00\s*3 jobs/);
    await pick("This month");
    expect(text()).toMatch(/Total spent\s*\$10\.00\s*1 job(?!s)/);
    await pick("This week");
    expect(text()).toMatch(/Total spent\s*\$15\.00\s*2 jobs/);
    await pick("Lifetime");
    expect(text()).toMatch(/Total spent\s*\$65\.50\s*4 jobs/);
  });

  it("its range row is the same one-row, sideways-scrolling control as the Earned card's", async () => {
    renderSpent();
    const group = await screen.findByRole("radiogroup", { name: "Spend date range" });
    expect(group.className).toMatch(/overflow-x-auto/);
    expect(group.className).not.toMatch(/flex-wrap/);
    // Each pill answers to its full name; the words it shows swap with the track's width (P4-3).
    const radios = within(group).getAllByRole("radio");
    expect(["Lifetime", "This week", "This month", "This year"].map((name) => within(group).getByRole("radio", { name }))).toEqual(radios);
  });

  it("lists the jobs paid for in the selected range, newest first, each with its own amount", async () => {
    renderSpent();
    await screen.findByText("Jobs you paid for");
    const titles = screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);
    expect(titles).toEqual(["Yard cleanup", "Job", "Gutter cleaning", "Old fence"]);
    expect(text()).toMatch(/Gutter cleaning\s*Sep 1\s*\$30\.00/);
    await act(async () => { fireEvent.click(screen.getByRole("radio", { name: "This week" })); });
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

// A3-111 (audit 8, 11-01): Spent rows were dead ends and an in-progress row said nothing about its held money.
// @mutate src/components/profile/earningsTab/SpentSection.tsx |   return r.cents > 0 ? " · Held until the job is approved" : ""; |   return "";
// @mutate src/components/profile/earningsTab/SpentSection.tsx |   if (r.job.status === "completed") return ""; |   if (r.job.status === "completed") return " · Held until the job is approved";
// @mutate src/components/profile/earningsTab/SpentSection.tsx |   return id ? `/jobs/${id}` : null; |   return null;
describe("A3-111: each Spent row opens its job and says where its money stands", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    filters = []; failRead = false; refundRows = []; giftRows = []; tipRows = []; blockFeeResult = { data: [], error: null };
  });
  afterEach(() => vi.useRealTimers());

  it("an in-progress job reads Held until the job is approved, a done one has no word, and each row links to /jobs/<id>", async () => {
    rows = [
      { id: "j-done", title: "Mow the lawn", budget: 50, poster_completed_at: "2026-10-02T15:00:00Z", helper_completed_at: null, created_at: "2026-10-01T15:00:00Z", customer_fee_amount: 2 },
      { id: "j-held", title: "Paint the fence", budget: 120, poster_completed_at: null, helper_completed_at: null, created_at: "2026-10-03T15:00:00Z", customer_fee_amount: 4, status: "in_progress", payment_status: "escrow" },
    ];
    renderSpent();
    await vi.waitFor(() => expect(document.querySelectorAll("[data-spent-row]").length).toBe(2));
    const links = [...document.querySelectorAll<HTMLAnchorElement>("a[data-spent-row]")];
    expect(links.map((a) => a.getAttribute("href")).sort()).toEqual(["/jobs/j-done", "/jobs/j-held"]);
    const held = links.find((a) => a.getAttribute("href") === "/jobs/j-held")!;
    expect(held.textContent).toMatch(/Held until the job is approved/);
    const done = links.find((a) => a.getAttribute("href") === "/jobs/j-done")!;
    expect(done.textContent).not.toMatch(/Held/);
  });
});

// A3-112 (audit 8, 11-01): Spent left out Declutter purchases (Receipts' rule: paid / handed over / refunded, what the
// card was charged, a refunded order $0 and "Refunded").
// @mutate src/components/profile/earningsTab/SpentSection.tsx |   const totalSpent = (spentTotalCents(rows) + bought.reduce((s, p) => s + p.cents, 0)) / 100; |   const totalSpent = spentTotalCents(rows) / 100;
// @mutate src/components/profile/earningsTab/SpentSection.tsx | ${boughtCount > 0 ? ` · ${boughtCount} purchase${boughtCount === 1 ? "" : "s"}` : ""} |
// @mutate src/components/profile/earningsTab/SpentSection.tsx |       {!isLoading && !isError && bought.length > 0 && ( |       {false && (
// @mutate src/lib/declutter/purchaseSpend.ts | cents: refunded ? 0 : paid?.get(o.id) ?? o.total_cents, | cents: o.total_cents,
// @mutate src/lib/declutter/purchaseSpend.ts | const COUNTED = ["paid", "handed_over", "refunded"]; | const COUNTED = ["paid", "handed_over", "refunded", "awaiting_payment"];
// @mutate src/components/profile/earningsTab/SpentSection.tsx |   const isError = spend.isError \|\| purchases.isError; |   const isError = spend.isError;
describe("A3-112: Declutter purchases count in Spent", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    filters = []; failRead = false; refundRows = []; giftRows = []; tipRows = []; blockFeeResult = { data: [], error: null };
    window.matchMedia = ((q: string) => ({
      matches: q.includes("reduce"), media: q, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { vi.useRealTimers(); orderRows = []; lineRows = []; paidRows = []; rows = []; failPaid = false; });

  it("adds each paid order at what the card was charged, names its items, says Refunded, and counts '1 job · 2 purchases'", async () => {
    rows = [{ id: "j1", title: "Mow the lawn", budget: 50, poster_completed_at: "2026-10-02T15:00:00Z", helper_completed_at: null, created_at: "2026-10-01T15:00:00Z", customer_fee_amount: 2 }];
    orderRows = [
      { id: "o1", status: "handed_over", total_cents: 2575, paid_at: "2026-10-03T15:00:00Z" },
      { id: "o2", status: "refunded", total_cents: 1000, paid_at: "2026-10-02T15:00:00Z" },
      { id: "o3", status: "awaiting_payment", total_cents: 999, paid_at: "2026-10-02T16:00:00Z" },
    ];
    lineRows = [{ order_id: "o1", item_title: "Oak rocking chair" }, { order_id: "o2", item_title: "Lamp" }, { order_id: "o2", item_title: "Rug" }];
    paidRows = [{ order_id: "o1", paid_cents: 2775 }];
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/Total spent\s*\$79\.75\s*1 job · 2 purchases/));
    const bought = [...document.querySelectorAll("a[data-spent-purchase]")];
    expect(bought.length).toBe(2);
    expect(bought[0].textContent).toMatch(/^Bought: Oak rocking chairOct 3\$27\.75$/);
    expect(bought[1].textContent).toMatch(/^Bought: Lamp and 1 moreOct 2 · Refunded\$0\.00$/);
    expect(bought[0].getAttribute("href")).toBe("/declutter?view=cart");
    expect(filters).toContainEqual(["declutter_orders", "buyer_id", "user-1"]);
  });

  it("a failed purchases read is a failed load, never a smaller total", async () => {
    rows = [{ id: "j1", title: "Mow the lawn", budget: 50, poster_completed_at: "2026-10-02T15:00:00Z", helper_completed_at: null, created_at: "2026-10-01T15:00:00Z", customer_fee_amount: 2 }];
    orderRows = [{ id: "o1", status: "paid", total_cents: 2575, paid_at: "2026-10-03T15:00:00Z" }];
    failPaid = true;
    renderSpent();
    await waitFor(() => expect(text()).toMatch(/couldn't load what you've spent/));
    expect(text()).not.toMatch(/Total spent/);
  });
});

