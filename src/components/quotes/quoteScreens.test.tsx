/**
 * Quotes on jobs, the client screens (owner Q1-Q8): what each state renders
 * and which server call each control makes. The Supabase client is stubbed at
 * its edge (rpc / functions.invoke / storage), so the real src/lib/quotes/api.ts
 * and src/lib/escrowCheckout.ts run: a booked quote pays through
 * create-payment { action: 'escrow', jobId } and nothing else. The backend is
 * proven by src/test/pglite/jobQuotes.pglite.mjs.
 *
 * @mutate src/components/quotes/MyQuoteCard.tsx | (quote.job_payment === "paid" \|\| quote.job_payment === undefined) | (true)
 * @mutate src/components/quotes/MyQuoteCard.tsx | ) : quote.job_payment === "bank_pending" ? ( | ) : false ? (
 * @mutate src/components/quotes/MyQuoteCard.tsx | ) : quote.job_payment === "closed" ? ( | ) : false ? (
 * @mutate src/components/quotes/quotesUi.tsx |   if (enabled) return <>{children}</>; |   return <>{children}</>;
 * @mutate src/lib/escrowCheckout.ts |       action: "escrow", |       action: "quote_checkout",
 * @mutate src/lib/escrowCheckout.ts |       ...(opts.returnPath ? { returnPath: opts.returnPath } : {}), |       ...{},
 * @mutate src/components/quotes/QuotePriceStepper.tsx |   if (!posterFee.settled \|\| posterFee.on \|\| !feeKnown) return null; |   if (posterFee.on) return null;
 * @mutate src/components/quotes/QuotePriceStepper.tsx | const STEP = 5; | const STEP = 10;
 * @mutate src/components/quotes/QuotesSideBySide.tsx |   if (live.length < 2) return null; |   return null;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |   if (reqs.isError) { |   if (reqs.isError \|\| quotes.isError) {
 * @mutate src/pages/quotes/QuoteRequestPage.tsx | const requestReturnPath = (requestId: string) => `/quotes/request/${requestId}`; | const requestReturnPath = (requestId: string) => `/post-job?r=${requestId}`;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |       const jobId = await bookAcceptedQuote(id); |       const jobId = id;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx | (agreed && (!request.job_id \|\| paid.data === "not_paid")) | (agreed && !request.job_id)
 * @mutate src/pages/quotes/QuoteRequestPage.tsx | (agreed && (!request.job_id \|\| paid.data === "not_paid")) | (agreed)
 * @mutate src/components/quotes/QuoteAnswerControls.tsx |   return n >= MIN_QUOTE_DOLLARS && n <= MAX_QUOTE_DOLLARS ? n : null; |   return n;
 * @mutate src/pages/quotes/SendQuotePage.tsx |   const ready = dollarsTyped != null && note.trim().length > 0 && when.trim().length > 0 && !uploading; |   const ready = !uploading;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |   const bookedJobId = request && (request.status === "agreed" \|\| request.status === "closed") ? request.job_id : null; |   const bookedJobId = request?.status === "agreed" ? request.job_id : null;
 * @mutate src/pages/quotes/QuoteRequestPage.tsx |     mutationFn: () => openEscrowCheckout(bookedJobId as string, { feeQuote, returnPath: requestReturnPath(id) }), |     mutationFn: () => bookAcceptedQuote(id),
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
import { readdirSync } from "@/test/helpers/trackedFiles";
import { effectiveDefs } from "@/test/helpers/effectiveFunctionDefs";
import { blankSqlComments } from "@/test/helpers/blankNonCode";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = {
  feature: true,
  posterFee: true,
  feeKnown: true,
  /** false: the switch's answer has not arrived (the gate's loading frame). */
  switchSettled: true,
  rpc: {} as Record<string, unknown>,
  calls: [] as { fn: string; args: unknown }[],
  invokes: [] as { name: string; body: unknown }[],
  opened: [] as string[],
  /** The jobs row fetchBookedJobPayment reads (payment_status), or an Error. */
  job: null as null | { payment_status: string; status?: string } | Error,
};

// 'jobs_poster_fee' is off on prod (2026-10-21): a booked quote is on the flat Helpr fee model.
vi.mock("@/hooks/useFeature", async (orig) => ({
  ...(await orig<typeof import("@/hooks/useFeature")>()),
  useFeature: (key: string) => (key === "jobs_poster_fee" ? state.posterFee : state.feature),
  useFeatureStatus: (key: string) => ({ on: key === "jobs_poster_fee" ? state.posterFee : state.feature, settled: state.switchSettled, lastAnswer: null }),
}));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeDollars: () => 0, useFirstPayoutFeeKnown: () => state.feeKnown }));
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

import { JobListQuotes } from "./JobListQuotes";
import { JobListQuotesSlot } from "./JobListQuotesSlot";
import QuoteRequestPage from "@/pages/quotes/QuoteRequestPage";
import SendQuotePage from "@/pages/quotes/SendQuotePage";
import { QUOTE_ERROR_COPY, quoteErrorMessage } from "@/lib/quotes/errors";
import { parseWholeDollars } from "./QuoteAnswerControls";
import { featureSwitchBatchKey } from "@/lib/featureSwitchQuery";

function at(path: string, el: React.ReactNode, route = path.split("?")[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (state.switchSettled) qc.setQueryData(featureSwitchBatchKey("u1"), { quotes: state.feature });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
          <Route path="/jobs" element={<p>My Jobs</p>} />
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
  state.posterFee = true;
  state.feeKnown = true;
});

describe("the 'quotes' switch", () => {
  it("off: every quote screen is the 404 and asks the server nothing", async () => {
    state.feature = false;
    // My Jobs and Posts draw no quotes section at all (the /quotes hub retired, owner 2026-10-19).
    const posts = at("/posts?quotes=1", <JobListQuotesSlot tab="posted" />, "/posts");
    const jobs = at("/jobs?quotes=1", <JobListQuotesSlot tab="applied" />, "/jobs");
    expect(posts.container.innerHTML + jobs.container.innerHTML).toBe("");
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    at("/quotes/send/r9", <SendQuotePage />, "/quotes/send/:id");
    expect(await screen.findAllByText("Page not found")).toHaveLength(2);
    expect(state.calls).toEqual([]);
  });

  // measure-loading-states, 2026-10-15: bones here swapped for the 404 with a -132px row and 2 -> 3 rows on all three routes.
  it.each([
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

  it("on: Posts lists the poster's quote requests with the quotes that came in, each opening its request", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    at("/posts?quotes=1", <JobListQuotes tab="posted" focus />, "/posts");
    const link = await screen.findByRole("link", { name: /Paint the back fence/ });
    expect(link).toHaveAttribute("href", "/quotes/request/r1");
    expect(link.textContent).toMatch(/Quote request/);
    expect(link.textContent).toMatch(/Taking quotes · 2 quotes/);
    expect(screen.getByRole("heading", { name: "Your quote requests" })).toBeInTheDocument();
  });
});

describe("board 43: the take-home waits for its reads (lh-money-escrow review #4)", () => {
  it("hides the figure while the setup fee is not known yet", async () => {
    state.rpc.list_open_quote_requests = [OPEN];
    state.posterFee = false;
    state.feeKnown = false;
    at("/quotes/send/r9", <SendQuotePage />, "/quotes/send/:id");
    fireEvent.change(await screen.findByLabelText("Your price in whole dollars"), { target: { value: "120" } });
    expect(document.querySelector("[data-quote-take-home]")).toBeNull();
  });
});

describe("board 115: quotes side by side", () => {
  it("two live quotes show side by side with the job price in rust and no take-home; one shows no table", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    state.rpc.get_quotes_for_request = [QUOTE, { ...QUOTE, id: "q2", quoter_id: "u2", quoter_name: "Ray Theriot", price_cents: 9500, photo_paths: [] }];
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    const table = await screen.findByRole("region", { name: "Quotes side by side" });
    expect(table.textContent).toMatch(/\$95/);
    expect(table.textContent).not.toMatch(/take.?home|receives/i);
    expect(screen.getByText(/Each amount is the job price/)).toBeInTheDocument();
    // AUD31-50: "use Dana, Ray's card" gave the two names one "'s".
    // @mutate src/components/quotes/QuotesSideBySide.tsx | ${own.slice(0, -1).join(", ")} or ${own[own.length - 1]} | ${names.join(", ")}
    expect(screen.getByText(/Each amount is the job price/).textContent).toContain("To accept, use Dana's or Ray's card below.");
  });

  it("one quote: no side-by-side", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    state.rpc.get_quotes_for_request = [QUOTE];
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    await screen.findAllByText(/\$/);
    expect(screen.queryByRole("region", { name: "Quotes side by side" })).toBeNull();
  });
});

describe("a missing quote request (nightly-red #2375)", () => {
  it("is a not-found message, never the load-error screen with Try again", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    // As on prod: get_quotes_for_request raises unknown_request (P0002) for an id that is not the caller's.
    state.rpc.get_quotes_for_request = new Error("unknown_request");
    at("/quotes/request/nope", <QuoteRequestPage />, "/quotes/request/:id");
    expect(await screen.findByText("We can't find this quote request.")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load this request.")).toBeNull();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
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

  // AUD31-63: Decline ended the quote on one tap, with no ask first.
  // @mutate src/components/quotes/QuoteAnswerControls.tsx | onClick={() => setConfirmDecline(true)} | onClick={() => answer.mutate("decline")}
  it("Decline asks first; only the confirm sends it, and Keep it sends nothing", async () => {
    state.rpc.get_my_quote_requests = [REQ];
    state.rpc.get_quotes_for_request = [QUOTE];
    state.rpc.respond_to_job_quote = "declined";
    at("/quotes/request/r1", <QuoteRequestPage />, "/quotes/request/:id");
    fireEvent.click(await screen.findByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Decline $250?")).toBeInTheDocument();
    expect(state.calls.some((c) => c.fn === "respond_to_job_quote")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    // Keep it closes the ask at once (shown two lines up), so no wait: a waitFor here would pass on its first poll.
    expect(screen.queryByText("Decline $250?")).not.toBeInTheDocument();
    expect(state.calls.some((c) => c.fn === "respond_to_job_quote")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Decline" }));
    fireEvent.click(await screen.findByRole("button", { name: "Decline quote" }));
    await waitFor(() => expect(state.calls.some((c) => c.fn === "respond_to_job_quote")).toBe(true));
    expect(state.calls.find((c) => c.fn === "respond_to_job_quote")?.args).toMatchObject({ p_action: "decline" });
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
      { name: "create-payment", body: { action: "escrow", jobId: "job-77", native: false, saveCardForFuture: false, feeQuote: { model: "poster", payInFour: false, totalShown: false }, payInFour: false, returnPath: "/quotes/request/r1" } },
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
      { name: "create-payment", body: { action: "escrow", jobId: "job-88", native: false, saveCardForFuture: false, feeQuote: { model: "poster", payInFour: false, totalShown: false }, payInFour: false, returnPath: "/quotes/request/r1" } },
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
    // Paid or settled: cancelling goes through the job's own flow, so the request offers none.
    expect(screen.queryByRole("button", { name: "Cancel this request" })).toBeNull();
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
    // Unpaid: the request can still be cancelled (cancel_quote_request deletes the unpaid job; Q2158).
    expect(screen.getByRole("button", { name: "Cancel this request" })).toBeInTheDocument();
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
    state.posterFee = false; // the flat model, as on prod today
    at("/quotes/send/r9", <SendQuotePage />, "/quotes/send/:id");
    expect(await screen.findByText("Mow and edge a corner lot")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: /Send quote/ });
    expect(send).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Your price in whole dollars"), { target: { value: "115" } });
    // Board 43: − / + move the price by $5; the take-home at that price is the apply sheet's own figure.
    fireEvent.click(screen.getByRole("button", { name: "$5 more" }));
    expect(screen.getByLabelText("Your price in whole dollars")).toHaveValue("120");
    // $120 - (10% of $120 + $0.70 = $12.70) = $107.30, floored to the dollar the transfer pays.
    // Owner 2026-10-25: the take-home only, no fee name or rate.
    expect(document.querySelector("[data-quote-take-home]")?.textContent).toMatch(/You take home \$107 if this quote is booked/);
    expect(document.querySelector("[data-quote-take-home]")?.textContent).not.toMatch(/fee|%/i);
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
    expect(screen.queryByLabelText("Your price in whole dollars")).toBeNull();
  });
});

describe("Your quotes on My Jobs (the quoter)", () => {
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
    at("/jobs?quotes=1", <JobListQuotes tab="applied" focus />, "/jobs");
    expect(await screen.findByText(/^They sent a counter-offer/)).toBeInTheDocument();
    expect(screen.getByText(/^Waiting for their answer/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Accept / })).toHaveLength(1);
    expect(screen.getByText("They: $100")).toBeInTheDocument();
  });

  it("Q1877: an accepted quote is booked only once the money lands; a bank payment still clearing says so", async () => {
    const base = {
      request_id: "r9", parish: "East Baton Rouge", date_needed: jobLocalDateISO(8), note: "Mow", available_note: "Friday",
      respond_until: null, status: "accepted", last_offer_side: "quoter", offers: [], created_at: "2026-10-15T09:00:00Z", price_cents: 9000,
    };
    state.rpc.get_my_job_quotes = [
      { ...base, id: "p", title: "Paid one", job_id: "job-p", job_payment: "paid" },
      { ...base, id: "b", title: "Bank one", job_id: "job-b", job_payment: "bank_pending" },
      { ...base, id: "u", title: "Unpaid one", job_id: "job-u", job_payment: "unpaid" },
      { ...base, id: "c", title: "Refunded one", job_id: "job-c", job_payment: "closed" },
    ];
    at("/jobs?quotes=1", <JobListQuotes tab="applied" focus />, "/jobs");
    const paid = (await screen.findByText("Paid one")).closest("li")!;
    expect(paid.textContent).toContain("It's booked.");
    const bank = screen.getByText("Bank one").closest("li")!;
    expect(bank.textContent).toContain("Bank payment pending. It is booked once their bank payment clears");
    expect(bank.textContent).not.toContain("It's booked");
    expect(bank.querySelector("a[href='/jobs/job-b']")).toBeNull();
    const unpaid = screen.getByText("Unpaid one").closest("li")!;
    expect(unpaid.textContent).toContain("Accepted. It is booked once it is paid for.");
    expect(unpaid.querySelector("a[href='/jobs/job-u']")).toBeNull();
    const closed = screen.getByText("Refunded one").closest("li")!;
    expect(closed.textContent).toContain("This job has closed.");
    expect(closed.textContent).not.toContain("paid for");
    // The server reads the job's money, not the quote: the migration's CASE is pinned here.
    const sql = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261021113222_my_quotes_say_bank_payment_pending.sql"), "utf8");
    expect(sql).toContain("WHEN public.job_payment_is_funded(j.payment_status) THEN 'paid'");
    expect(sql).toContain("WHEN j.payment_status = 'unpaid' AND j.stripe_payment_intent_id IS NOT NULL");
  });
});

describe("error copy", () => {
  it("every code the quote migration raises has words (exact), and no code reaches the member", () => {
    // The NEWEST definition of every function a quote migration defines
    // (effectiveDefs: a later restatement replaces an earlier body, any
    // dollar tag, drops replayed), so a code a restatement removed or added is
    // read as prod runs it, whichever migration holds the live body.
    const dir = resolve(__dirname, "../../../supabase/migrations");
    const defs = effectiveDefs(dir);
    const quoteFns = new Set(
      readdirSync(dir)
        // whole-word quote migrations only: 20261021130723_poster_cancel_checks_quoted_fee is the cancel, not a quote
        .filter((f) => /_quotes?[_.]/.test(f) && f.endsWith(".sql"))
        .flatMap((f) => [...blankSqlComments(readFileSync(resolve(dir, f), "utf8")).matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.(\w+)\s*\(/gi)].map((m) => m[1].toLowerCase())),
    );
    expect(quoteFns.size).toBeGreaterThan(10);
    const sql = [...quoteFns].map((fn) => blankSqlComments(defs.get(fn)?.stmt ?? "")).join("\n");
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
