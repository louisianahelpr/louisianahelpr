/**
 * Quotes on jobs, the client screens (owner Q1-Q8): what each state renders
 * and which server call each control makes. The Supabase client is stubbed at
 * its edge (rpc / functions.invoke / storage), so the real src/lib/quotes/api.ts
 * and src/lib/escrowCheckout.ts run: a booked quote pays through
 * create-payment { action: 'escrow', jobId } and nothing else. The backend is
 * proven by src/test/pglite/jobQuotes.pglite.mjs.
 *
 * @mutate src/components/quotes/quotesUi.tsx |   if (enabled) return <>{children}</>; |   return <>{children}</>;
 * @mutate src/lib/escrowCheckout.ts |       action: "escrow", |       action: "quote_checkout",
 * @mutate src/lib/escrowCheckout.ts |       ...(opts.returnPath ? { returnPath: opts.returnPath } : {}), |       ...{},
 * @mutate src/pages/quotes/QuoteRequestPage.tsx | const requestReturnPath = (requestId: string) => `/quotes/request/${requestId}`; | const requestReturnPath = (requestId: string) => `/post-job?r=${requestId}`;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |       const jobId = await bookAcceptedQuote(id); |       const jobId = id;
 * @mutate src/components/quotes/QuoteAnswerControls.tsx |   return n >= MIN_QUOTE_DOLLARS && n <= MAX_QUOTE_DOLLARS ? n : null; |   return n;
 * @mutate src/pages/quotes/SendQuotePage.tsx |   const ready = dollarsTyped != null && note.trim().length > 0 && when.trim().length > 0 && !uploading; |   const ready = !uploading;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |   const bookedJobId = request && (request.status === "agreed" \|\| request.status === "closed") ? request.job_id : null; |   const bookedJobId = request?.status === "agreed" ? request.job_id : null;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |     mutationFn: () => openEscrowCheckout(bookedJobId as string, { returnPath: requestReturnPath(id) }), |     mutationFn: () => bookAcceptedQuote(id),
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |             Book and pay\n |             Book and pay {dollars(accepted.price_cents)}\n
 * @mutate src/components/quotes/MyQuoteCard.tsx |   const myTurn = pending && quote.last_offer_side === "poster"; |   const myTurn = pending;
 * @mutate src/components/quotes/quotesUi.tsx |   return settled ? <NotFound /> : <QuotesGateFrame title={title} backTo={backTo} label={label} />; |   return settled ? <NotFound /> : null;
 * @mutate src/components/quotes/quotesUi.tsx |       <p role="status" className="sr-only"> |       <p role="status" className="sr-only animate-pulse">
 * @mutate src/lib/quotes/api.ts |   if (s === "refunded") return "refunded"; |   if (s === "refunded") return "paid";
 * @mutate src/lib/quotes/api.ts |   if (s === "cancelled") return "cancelled"; |   if (s === "cancelled") return "paid";
 * @mutate src/lib/quotes/api.ts |   if (s === "cancelling") return "cancelling"; |   if (s === "cancelling") return "cancelled";
 * @mutate src/lib/quotes/api.ts |   if (jobStatus === "cancelled" && (NEVER_PAID_STATUSES as readonly string[]).includes(s)) return "cancelled"; |   void jobStatus;
 * @mutate src/lib/quotes/api.ts |   if (s === "chargeback") return "disputed"; |   if (s === "chargeback") return "paid";
 * @mutate src/lib/quotes/api.ts |   return "unknown";\n} |   return "paid";\n}
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |   return ownPrice ? "Posted" : "Booked";\n} |   return ownPrice ? "Posted and paid" : "Booked and paid";\n}
 */
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  feature: true,
  /** false: the switch's answer has not arrived (the gate's loading frame). */
  switchSettled: true,
  rpc: {} as Record<string, unknown>,
  calls: [] as { fn: string; args: unknown }[],
  invokes: [] as { name: string; body: unknown }[],
  opened: [] as string[],
  /** The jobs row fetchBookedJobPayment reads (payment_status), or an Error. */
  job: null as null | { payment_status: string; status?: string } | Error,
};

vi.mock("@/hooks/useFeature", () => ({ useFeature: () => state.feature }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/hooks/useAgeGate", () => ({ useAgeGate: () => ({ underAge: false }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/components/AppPage", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <main>
      <h1>{title}</h1>
      {children}
    </main>
  ),
}));
vi.mock("@/pages/info/NotFound", () => ({ default: () => <p>Page not found</p> }));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: async (u: string) => void state.opened.push(u) }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string, args: unknown) => {
      state.calls.push({ fn, args });
      const v = state.rpc[fn];
      if (v instanceof Error) return { data: null, error: { message: v.message } };
      return { data: v ?? null, error: null };
    },
    functions: {
      invoke: async (name: string, opts: { body: unknown }) => {
        state.invokes.push({ name, body: opts.body });
        return { data: { url: "https://checkout.stripe.com/c/pay/cs_test" }, error: null };
      },
    },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            state.calls.push({ fn: `from:${table}`, args: null });
            if (state.job instanceof Error) return { data: null, error: { message: state.job.message } };
            return { data: state.job, error: null };
          },
        }),
      }),
    }),
    storage: {
      from: () => ({
        getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }),
        upload: async () => ({ error: null }),
        remove: async () => ({ error: null }),
      }),
    },
  },
}));

import QuotesPage from "@/pages/quotes/QuotesPage";
import QuoteRequestPage from "@/pages/quotes/QuoteRequestPage";
import SendQuotePage from "@/pages/quotes/SendQuotePage";
import { QUOTE_ERROR_COPY, quoteErrorMessage } from "@/lib/quotes/errors";
import { parseWholeDollars } from "./QuoteAnswerControls";

function at(path: string, el: React.ReactNode, route = path.split("?")[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (state.switchSettled) qc.setQueryData(["feature-enabled", "quotes", "u1"], state.feature);
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
          <Route path="/quotes" element={<p>Quotes list</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const REQ = {
  id: "r1", title: "Paint the back fence", category: "painting", date_needed: jobLocalDateISO(9), parish: "East Baton Rouge",
  window_hours: 48, quotes_close_at: new Date(Date.now() + 30 * 3_600_000).toISOString(), status: "open", job_id: null,
  quote_count: 2, created_at: "2026-10-15T10:00:00Z",
};
const QUOTE = {
  id: "q1", quoter_id: "u2", quoter_name: "Dana", quoter_avatar_url: null, price_cents: 25000,
  note: "Two coats, I bring the paint", available_note: "Saturday morning", photo_paths: ["u2/quotes/a.jpg"],
  last_offer_side: "quoter", respond_until: new Date(Date.now() + 40 * 3_600_000).toISOString(), status: "pending",
  offers: [{ by: "quoter", price_cents: 25000, note: "Two coats", at: "2026-10-15T10:00:00Z" }], created_at: "2026-10-15T10:00:00Z",
};
const OPEN = {
  id: "r9", title: "Mow and edge a corner lot", description: "About a quarter acre, front and back.", category: "lawn_care",
  date_needed: jobLocalDateISO(8), start_time: null, estimated_hours: 2, location: "Mid-City, Baton Rouge", latitude: 30.45,
  longitude: -91.15, parish: "East Baton Rouge", quotes_close_at: new Date(Date.now() + 20 * 3_600_000).toISOString(),
  created_at: "2026-10-15T09:00:00Z", my_quote_id: null, my_quote_status: null,
};

beforeEach(() => {
  state.feature = true;
  state.switchSettled = true;
  state.rpc = {};
  state.calls = [];
  state.invokes = [];
  state.opened = [];
  state.job = null;
});

describe("the 'quotes' switch", () => {
  it("off: every quote screen is the 404 and asks the server nothing", async () => {
    state.feature = false;
    at("/quotes", <QuotesPage />);
    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.queryByText("Your requests")).toBeNull();
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    at("/quotes/send/r9", <SendQuotePage />, "/quotes/send/:id");
    expect(screen.getAllByText("Page not found")).toHaveLength(3);
    expect(state.calls).toEqual([]);
  });

  // measure-loading-states, 2026-10-15: bones here swapped for the 404 with a -132px row and 2 -> 3 rows on all three routes.
  it.each([
    ["/quotes", "/quotes", "Quotes", "Loading quotes", () => <QuotesPage />],
    ["/quotes/request/r1", "/quotes/request/:id", "Quotes for your job", "Loading the request", () => <QuoteRequestPage />],
    ["/quotes/send/r9", "/quotes/send/:id", "Send a quote", "Loading the request", () => <SendQuotePage />],
  ])("while the switch loads, %s is its real header with no bones (the answer may still be the 404)", (path, route, title, label, el) => {
    state.feature = false;
    state.switchSettled = false;
    const { container } = at(path, el(), route);
    expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    expect(screen.getByRole("status").textContent).toBe(label);
    expect(container.querySelector('[class*="animate-"], [aria-busy="true"]')).toBeNull();
    expect(screen.queryByText("Page not found")).toBeNull();
    expect(state.calls).toEqual([]);
  });

  it("on: /quotes shows the three views; Open requests offers Send a quote", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    state.rpc.list_open_quote_requests = [OPEN];
    at("/quotes?view=open", <QuotesPage />);
    expect(await screen.findByText("Mow and edge a corner lot")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a quote" })).toHaveAttribute("href", "/quotes/send/r9");
    expect(screen.getByRole("tab", { name: "Your requests" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Your quotes" })).toBeInTheDocument();
  });
});

describe("the poster's quotes on a request", () => {
  it("lists each quote with its price, note, when and photos; the poster's turn offers accept / counter / decline", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    state.rpc.get_quotes_for_request = [QUOTE];
    state.rpc.respond_to_job_quote = "accepted";
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByText("Two coats, I bring the paint")).toBeInTheDocument();
    expect(screen.getByText("Can do it: Saturday morning")).toBeInTheDocument();
    expect(screen.getByAltText("Past work")).toHaveAttribute("src", "https://cdn/u2/quotes/a.jpg");
    expect(screen.getByRole("button", { name: "Counter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Set my own price instead" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Accept $250" }));
    await waitFor(() => expect(state.calls.some((c) => c.fn === "respond_to_job_quote")).toBe(true));
    expect(state.calls.find((c) => c.fn === "respond_to_job_quote")?.args).toEqual({
      p_quote_id: "q1", p_action: "accept", p_price_cents: undefined, p_note: undefined,
    });
  });

  it("a counter sends whole dollars as cents; a price outside $10-$1,000 cannot be sent", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    state.rpc.get_quotes_for_request = [QUOTE];
    state.rpc.respond_to_job_quote = "countered";
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    fireEvent.click(await screen.findByRole("button", { name: "Counter" }));
    const price = screen.getByLabelText("Your price (whole dollars)");
    fireEvent.change(price, { target: { value: "5" } });
    expect(screen.getByRole("button", { name: "Send counter-offer" })).toBeDisabled();
    fireEvent.change(price, { target: { value: "$210" } });
    fireEvent.click(screen.getByRole("button", { name: "Send counter-offer" }));
    await waitFor(() => expect(state.calls.some((c) => c.fn === "respond_to_job_quote")).toBe(true));
    expect(state.calls.find((c) => c.fn === "respond_to_job_quote")?.args).toMatchObject({ p_action: "counter", p_price_cents: 21000 });
  });

  it("an agreed quote is booked, then paid through the ONE escrow checkout with that job id", async () => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "agreed" }];
    state.rpc.get_quotes_for_request = [{ ...QUOTE, status: "accepted" }];
    state.rpc.book_accepted_quote = "job-77";
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    fireEvent.click(await screen.findByRole("button", { name: "Book and pay" }));
    await waitFor(() => expect(state.opened).toEqual(["https://checkout.stripe.com/c/pay/cs_test"]));
    expect(state.calls.find((c) => c.fn === "book_accepted_quote")?.args).toEqual({ p_request_id: "r1" });
    expect(state.invokes).toEqual([
      // Q1862: a cancelled quote checkout comes back to this request page.
      { name: "create-payment", body: { action: "escrow", jobId: "job-77", native: false, saveCardForFuture: false, returnPath: "/quotes/request/r1" } },
    ]);
  });
});

describe("a job made from a request but not paid yet can always be paid (lh-money-escrow review, 2026-10-15)", () => {
  it("posted at the poster's own price (closed) with an unpaid job: Pay now opens the escrow checkout for that job", async () => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "closed", job_id: "job-88" }];
    state.rpc.get_quotes_for_request = [{ ...QUOTE, status: "closed" }];
    state.job = { payment_status: "unpaid" };
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByText("Not paid yet")).toBeInTheDocument();
    expect(screen.getByText(/Pay to post your job\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pay now" }));
    await waitFor(() => expect(state.opened).toEqual(["https://checkout.stripe.com/c/pay/cs_test"]));
    expect(state.invokes).toEqual([
      // Q1862: a cancelled quote checkout comes back to this request page.
      { name: "create-payment", body: { action: "escrow", jobId: "job-88", native: false, saveCardForFuture: false, returnPath: "/quotes/request/r1" } },
    ]);
    // A closed request refuses book_accepted_quote (no_agreed_quote): paying never goes through it.
    expect(state.calls.some((c) => c.fn === "book_accepted_quote")).toBe(false);
  });

  it("an agreed quote whose job is unpaid pays that job; once paid it links to the job", async () => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "agreed", job_id: "job-77" }];
    state.rpc.get_quotes_for_request = [{ ...QUOTE, status: "accepted" }];
    state.job = { payment_status: "abandoned" };
    const first = at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    fireEvent.click(await screen.findByRole("button", { name: "Pay now" }));
    await waitFor(() => expect(state.invokes).toHaveLength(1));
    expect(state.invokes[0]).toMatchObject({ name: "create-payment", body: { action: "escrow", jobId: "job-77" } });
    first.unmount();
    state.job = { payment_status: "escrow" };
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByText("Booked and paid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job" })).toHaveAttribute("href", "/jobs/job-77");
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull();
  });

  // Q1874: every jobs_payment_status_check value gets its own words; only
  // money held or paid out reads "paid". A status the client does not know is
  // never called paid either.
  it.each([
    ["escrow", "Booked and paid"],
    ["payout_pending", "Booked and paid"],
    ["released", "Booked and paid"],
    ["refunded", "Refunded"],
    ["cancelled", "Cancelled"],
    ["cancelling", "Being cancelled"],
    ["chargeback", "Payment disputed"],
    ["some_new_status", "Booked"],
  ])("a booked job with payment_status %s reads %s, linked to the job", async (ps, title) => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "agreed", job_id: "job-66" }];
    state.rpc.get_quotes_for_request = [{ ...QUOTE, status: "accepted" }];
    state.job = { payment_status: ps };
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByText(title)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the job" })).toHaveAttribute("href", "/jobs/job-66");
    if (title !== "Booked and paid") expect(screen.queryByText(/paid/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull();
  });

  // lh-money-escrow review should-fix 1: auto-expire cancels an open unpaid
  // job and leaves payment_status 'unpaid'; create-payment refuses to fund it,
  // so the screen says Cancelled and offers no Pay button.
  it("a booked job cancelled while unpaid reads Cancelled, with no Pay now", async () => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "agreed", job_id: "job-66" }];
    state.rpc.get_quotes_for_request = [{ ...QUOTE, status: "accepted" }];
    state.job = { payment_status: "unpaid", status: "cancelled" };
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull();
    expect(screen.queryByText("Not paid yet")).toBeNull();
  });

  it.each(["unpaid", "abandoned", "failed"])("a booked job with payment_status %s offers Pay now", async (ps) => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "agreed", job_id: "job-66" }];
    state.rpc.get_quotes_for_request = [{ ...QUOTE, status: "accepted" }];
    state.job = { payment_status: ps };
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByRole("button", { name: "Pay now" })).toBeInTheDocument();
    expect(screen.queryByText("Booked and paid")).toBeNull();
  });

  it("when the paid check fails the screen says so and offers a retry, never a blank", async () => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "closed", job_id: "job-88" }];
    state.rpc.get_quotes_for_request = [];
    state.job = new Error("network");
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByText("We couldn't check whether this job is paid.")).toBeInTheDocument();
  });

  it("no pay button names an amount: create-payment can add the setup fee and sales tax", async () => {
    state.rpc.get_my_quote_requests = [{ ...REQ, status: "agreed" }];
    state.rpc.get_quotes_for_request = [{ ...QUOTE, status: "accepted" }];
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByRole("button", { name: "Book and pay" })).toBeInTheDocument();
    expect(screen.getByText(/Checkout shows your total before you pay\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pay.*\$\d/i })).toBeNull();
  });
});

describe("the quoter's send-a-quote form", () => {
  it("sends price, note, when and photos only once all three are filled", async () => {
    state.rpc.list_open_quote_requests = [OPEN];
    state.rpc.submit_job_quote = "q9";
    at("/quotes/send/r9", <SendQuotePage />, "/quotes/send/:id");
    expect(await screen.findByText("Mow and edge a corner lot")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: /Send quote/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Total price (whole dollars)"), { target: { value: "120" } });
    fireEvent.change(screen.getByLabelText("What's included"), { target: { value: "Mow, edge and blow" } });
    expect(screen.getByRole("button", { name: "Send quote · $120" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("When you can do it"), { target: { value: "Friday after 3" } });
    fireEvent.click(screen.getByRole("button", { name: "Send quote · $120" }));
    await waitFor(() => expect(state.calls.some((c) => c.fn === "submit_job_quote")).toBe(true));
    expect(state.calls.find((c) => c.fn === "submit_job_quote")?.args).toEqual({
      p_request_id: "r9", p_price_cents: 12000, p_note: "Mow, edge and blow", p_available_note: "Friday after 3", p_photo_paths: [],
    });
  });

  it("a request that closed reads as closed, with no form", async () => {
    state.rpc.list_open_quote_requests = [];
    at("/quotes/send/r9", <SendQuotePage />, "/quotes/send/:id");
    expect(await screen.findByText("This request isn't taking quotes anymore")).toBeInTheDocument();
    expect(screen.queryByLabelText("Total price (whole dollars)")).toBeNull();
  });
});

describe("Your quotes (the quoter)", () => {
  it("a poster's counter is the quoter's turn; the quoter's own last offer waits", async () => {
    const base = {
      request_id: "r9", title: "Mow and edge a corner lot", parish: "East Baton Rouge", date_needed: jobLocalDateISO(8),
      note: "Mow", available_note: "Friday", respond_until: new Date(Date.now() + 10 * 3_600_000).toISOString(),
      status: "pending", job_id: null, created_at: "2026-10-15T09:00:00Z",
    };
    state.rpc.get_my_job_quotes = [
      { ...base, id: "a", price_cents: 10000, last_offer_side: "poster", offers: [
        { by: "quoter", price_cents: 12000, note: null, at: "1" }, { by: "poster", price_cents: 10000, note: null, at: "2" }] },
      { ...base, id: "b", title: "Haul a sofa", price_cents: 8000, last_offer_side: "quoter", offers: [] },
    ];
    at("/quotes?view=mine", <QuotesPage />);
    expect(await screen.findByText(/^They sent a counter-offer/)).toBeInTheDocument();
    expect(screen.getByText(/^Waiting for their answer/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Accept / })).toHaveLength(1);
    expect(screen.getByText("They: $100")).toBeInTheDocument();
  });
});

describe("error copy", () => {
  it("every code the quote migration raises has words (exact), and no code reaches the member", () => {
    // Every migration that defines a quote RPC: 20261017045002 restates
    // submit / respond / cancel, so its codes are the live ones.
    const sql = ["20261015091114_job_quotes.sql", "20261017045002_quote_hire_on_pay_alerts.sql"]
      .map((f) => readFileSync(resolve(__dirname, "../../../supabase/migrations", f), "utf8"))
      .join("\n");
    const raised = [...new Set([...sql.matchAll(/RAISE EXCEPTION '([a-z_0-9]+)'/g)].map((m) => m[1]))].sort();
    expect(raised.length).toBeGreaterThan(20);
    const copied = Object.keys(QUOTE_ERROR_COPY).filter((k) => k !== "feature_disabled").sort();
    expect(copied).toEqual(raised);
    for (const code of raised) expect(quoteErrorMessage(new Error(code))).not.toMatch(/_/);
    expect(quoteErrorMessage(new Error("Phone number detected in the note"))).toBe("Phone number detected in the note");
  });

  it("whole dollars only, from $10 to $1,000", () => {
    expect(parseWholeDollars("$1,000")).toBe(1000);
    expect(parseWholeDollars("10")).toBe(10);
    expect(parseWholeDollars("9")).toBeNull();
    expect(parseWholeDollars("12.50")).toBeNull();
    expect(parseWholeDollars("1001")).toBeNull();
  });
});
