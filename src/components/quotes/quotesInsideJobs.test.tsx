/**
 * Owner decision 2026-10-19: quotes live INSIDE Post a Job, Jobs, My Jobs and
 * Posts; the standalone /quotes hub retired. Screen tests for each new home,
 * all behind the unchanged 'quotes' switch:
 *   - old /quotes links redirect (poster view -> Posts, open requests -> the
 *     Jobs feed's Wants Quotes lens, sent quotes -> My Jobs);
 *   - the Jobs feed can be opened on the lens by link, and each open request
 *     there is marked "Quote request" with Send a quote as its action;
 *   - My Jobs shows the quotes a member sent, Posts the requests they made;
 *     both stay empty with the switch off.
 *
 * @mutate src/lib/quotes/homes.ts |   if (view === "mine") return QUOTE_HOMES.myQuotes; |   if (view === "mine") return QUOTE_HOMES.myRequests;
 * @mutate src/lib/quotes/homes.ts |   if (view === "open") return QUOTE_HOMES.openRequests; |   if (view === "open") return QUOTE_HOMES.myRequests;
 * @mutate src/pages/home/useWantsQuotes.ts | useState(() => params.get("wantsQuotes") === "1"); | useState(false);
 * @mutate src/components/quotes/OpenQuoteRequestRow.tsx |         Quote request\n |         \n
 * @mutate src/components/quotes/JobListQuotesSlot.tsx |   if (!quotesOn) return null; |   if (false) return null;
 * @mutate src/components/job-card/JobListPage.tsx |           <JobListQuotesSlot tab={tab} /> |           {null}
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { blankComments } from "@/test/helpers/blankNonCode";
import { jobLocalDateISO } from "@/test/helpers/jobLocalDate";

const state = { feature: true, rpc: {} as Record<string, unknown>, calls: [] as string[], myRequests: [] as string[] };

vi.mock("@/hooks/useFeature", () => ({
  useFeature: (key: string) => (key === "quotes" ? state.feature : false),
  useFeatureStatus: (key: string) => ({ on: key === "quotes" ? state.feature : false, settled: true }),
}));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (fn: string) => {
      state.calls.push(fn);
      return { data: state.rpc[fn] ?? [], error: null };
    },
    // QuotesHubRedirect's one-row read: job_quote_requests by id AND poster_id.
    from: (table: string) => {
      const eqs: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => { eqs[col] = v; return q; },
        maybeSingle: async () => {
          state.calls.push(`${table}:${JSON.stringify(eqs)}`);
          const mine = table === "job_quote_requests" && eqs.poster_id === "u1" && state.myRequests.includes(String(eqs.id));
          return { data: mine ? { id: eqs.id } : null, error: null };
        },
      };
      return q;
    },
  },
}));

import QuotesHubRedirect from "@/components/quotes/QuotesHubRedirect";
import { OpenQuoteRequestRow } from "@/components/quotes/OpenQuoteRequestRow";
import { JobListQuotesSlot } from "@/components/quotes/JobListQuotesSlot";
import { useWantsQuotes } from "@/pages/home/useWantsQuotes";
import { QUOTE_HOMES } from "@/lib/quotes/homes";

const src = (rel: string) => blankComments(readFileSync(resolve(__dirname, "../../..", rel), "utf8"));

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname + l.search}</p>;
}

function at(path: string, el: ReactNode, route = path.split("?")[0]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={route} element={el} />
          {["/posts", "/jobs", "/home", "/quotes/request/:id"].filter((p) => p !== route).map((p) => <Route key={p} path={p} element={<Where />} />)}
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const OPEN = {
  id: "r9", title: "Mow and edge a corner lot", description: "About a quarter acre.", category: "lawn_care",
  date_needed: jobLocalDateISO(11), start_time: null, estimated_hours: 2, location: "Mid-City, Baton Rouge", latitude: 30.45,
  longitude: -91.15, parish: "East Baton Rouge", quotes_close_at: new Date(Date.now() + 20 * 3_600_000).toISOString(),
  created_at: "2026-10-15T09:00:00Z", my_quote_id: null, my_quote_status: null,
};

beforeEach(() => {
  state.feature = true;
  state.rpc = {};
  state.calls = [];
  state.myRequests = [];
});

describe("old /quotes links redirect to the new homes", () => {
  it.each([
    ["/quotes", "/posts?quotes=1"],
    ["/quotes?user=3f0c9a4e-0000-4000-8000-000000000000", "/posts?quotes=1"],
    ["/quotes?view=requests", "/posts?quotes=1"],
    ["/quotes?view=open", "/home?wantsQuotes=1"],
    ["/quotes?view=mine", "/jobs?quotes=1"],
  ])("%s -> %s", (from, to) => {
    at(from, <QuotesHubRedirect />, "/quotes");
    expect(screen.getByTestId("where").textContent).toBe(to);
  });

  // A quote notice links '/quotes?request=<id>' (Q2177): the side is read from that one request when it is opened.
  const RID = "6b1f9c2e-1111-4222-8333-444455556666";
  it("a request notice opens the request page for the member who posted it", async () => {
    state.myRequests = [RID];
    at(`/quotes?request=${RID}&user=3f0c9a4e-0000-4000-8000-000000000000`, <QuotesHubRedirect />, "/quotes");
    expect((await screen.findByTestId("where")).textContent).toBe(`/quotes/request/${RID}`);
    expect(state.calls).toContain(`job_quote_requests:${JSON.stringify({ id: RID, poster_id: "u1" })}`);
  });

  it("a request notice opens the quoter's own quotes for anyone else", async () => {
    at(`/quotes?request=${RID}`, <QuotesHubRedirect />, "/quotes");
    expect((await screen.findByTestId("where")).textContent).toBe(QUOTE_HOMES.myQuotes);
  });

  it("with the quotes switch off a request link follows the old-link rule (no dead Retry)", async () => {
    state.feature = false;
    at(`/quotes?request=${RID}`, <QuotesHubRedirect />, "/quotes");
    expect((await screen.findByTestId("where")).textContent).toBe("/posts?quotes=1");
    expect(state.calls).toEqual([]);
  });

  it("the quote screens' own links and back buttons go to the new homes", () => {
    // Inventory floor (vacuity: the files read here must exist and hold real code).
    expect(src("src/pages/quotes/SendQuotePage.tsx").length).toBeGreaterThan(500);
    expect(src("src/pages/quotes/QuoteRequestPage.tsx").length).toBeGreaterThan(500);
    expect(src("src/pages/quotes/SendQuotePage.tsx")).toContain("navigate(QUOTE_HOMES.myQuotes, { replace: true });");
    expect(src("src/pages/quotes/SendQuotePage.tsx")).toContain("backTo={QUOTE_HOMES.openRequests}");
    expect(src("src/pages/quotes/QuoteRequestPage.tsx")).toContain("backTo={QUOTE_HOMES.myRequests}");
  });
});

describe("Jobs: open quote requests in the browse feed", () => {
  const wrap = (path: string) => ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[path]}>{children}</MemoryRouter>;

  it("a link opens Jobs on the Wants Quotes lens, only while the switch is on", () => {
    expect(renderHook(() => useWantsQuotes(), { wrapper: wrap(QUOTE_HOMES.openRequests) }).result.current.wantsQuotes).toBe(true);
    expect(renderHook(() => useWantsQuotes(), { wrapper: wrap("/home") }).result.current.wantsQuotes).toBe(false);
    state.feature = false;
    expect(renderHook(() => useWantsQuotes(), { wrapper: wrap(QUOTE_HOMES.openRequests) }).result.current.wantsQuotes).toBe(false);
  });

  it('each request is marked "Quote request" with Send a quote as its action', () => {
    render(<MemoryRouter><ul><OpenQuoteRequestRow r={OPEN as never} /></ul></MemoryRouter>);
    expect(screen.getByText("Quote request")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send a quote" })).toHaveAttribute("href", "/quotes/send/r9");
  });

  it("once quoted, it points to the quote on My Jobs", () => {
    render(<MemoryRouter><ul><OpenQuoteRequestRow r={{ ...OPEN, my_quote_id: "q1", my_quote_status: "pending" } as never} /></ul></MemoryRouter>);
    expect(screen.queryByRole("link", { name: "Send a quote" })).toBeNull();
    expect(screen.getByRole("link", { name: "See it in My Jobs" })).toHaveAttribute("href", "/jobs?quotes=1");
  });
});

describe("My Jobs and Posts: the member's quotes", () => {
  it("My Jobs shows the quotes this member sent", async () => {
    state.rpc.get_my_job_quotes = [{
      id: "a", request_id: "r9", title: "Haul a sofa", parish: "East Baton Rouge", date_needed: jobLocalDateISO(11), note: "Truck",
      available_note: "Friday", respond_until: new Date(Date.now() + 3_600_000).toISOString(), status: "pending", job_id: null,
      created_at: "2026-10-15T09:00:00Z", price_cents: 8000, last_offer_side: "quoter", offers: [],
    }];
    at("/jobs", <JobListQuotesSlot tab="applied" />);
    expect(await screen.findByRole("heading", { name: "Your quotes" })).toBeInTheDocument();
    expect(screen.getByText("Haul a sofa")).toBeInTheDocument();
    expect(state.calls).toEqual(["get_my_job_quotes"]);
  });

  it("with nothing sent it draws nothing, unless a link asked for it", async () => {
    const quiet = at("/jobs", <JobListQuotesSlot tab="applied" />);
    await Promise.resolve();
    expect(quiet.container.querySelector("[data-job-list-quotes]")).toBeNull();
    quiet.unmount();
    at(QUOTE_HOMES.myQuotes, <JobListQuotesSlot tab="applied" />, "/jobs");
    expect(await screen.findByText("You haven't sent any quotes yet")).toBeInTheDocument();
  });

  it("switch off: neither page draws a quotes section or asks the server", () => {
    state.feature = false;
    const a = at(QUOTE_HOMES.myQuotes, <JobListQuotesSlot tab="applied" />, "/jobs");
    const b = at(QUOTE_HOMES.myRequests, <JobListQuotesSlot tab="posted" />, "/posts");
    expect(a.container.innerHTML + b.container.innerHTML).toBe("");
    expect(state.calls).toEqual([]);
  });

  it("both list pages mount it, on a full list and an empty one", () => {
    const page = src("src/components/job-card/JobListPage.tsx");
    expect(page).toContain("<JobListQuotesSlot tab={tab} />");
    expect(page).toContain('<JobListQuotesSlot tab={tab} className="mx-4 mt-3" />');
  });
});
