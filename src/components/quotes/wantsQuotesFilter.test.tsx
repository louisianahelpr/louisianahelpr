/**
 * Owner answer 12 (2026-10-17): quote requests show up in Jobs browse through a
 * "Wants Quotes" filter (and under a Quotes link in the menu,
 * quotesMenuLink.test.tsx), only while the hidden 'quotes' switch is on.
 *
 * The filter row exists only when the page passes its toggle; the Dashboard
 * passes it only while useFeature("quotes") is on, and with it on swaps the job
 * feed for WantsQuotesFeed (list_open_quote_requests, not open_jobs_browse:
 * quote requests are not jobs yet) and steps the map column aside.
 *
 * @mutate src/pages/home/Dashboard.tsx |                     onToggleWantsQuotes={quotesOn ? toggleWantsQuotes : undefined} |                     onToggleWantsQuotes={toggleWantsQuotes}
 * @mutate src/pages/home/Dashboard.tsx |   const wantsQuotes = quotesOn && wantsQuotesPicked; |   const wantsQuotes = wantsQuotesPicked;
 * @mutate src/pages/home/Dashboard.tsx | {isWebDesktop && mapVisible && !feedShowingLoadError && !wantsQuotes && ( | {isWebDesktop && mapVisible && !feedShowingLoadError && (
 * @mutate src/components/dashboard/FilterSheet.tsx |           {onToggleWantsQuotes && ( |           {false && (
 * @mutate src/components/quotes/WantsQuotesFeed.tsx |             <OpenQuoteRequestRow key={r.id} r={r} /> |             null
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/quotes/api", () => ({ fetchOpenQuoteRequests: async () => state.rows }));

import { WantsQuotesFeed } from "@/components/quotes/WantsQuotesFeed";
import { buildJobFilterSections } from "@/components/dashboard/FilterSheet";

const root = resolve(__dirname, "../../..");
const src = (rel: string) => blankComments(readFileSync(resolve(root, rel), "utf8"));

const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const REQ = {
  id: "r1", title: "Paint the fence", description: "Two coats on a 60 ft wooden fence", category: "yard_work",
  date_needed: "2099-01-05", start_time: null, estimated_hours: 4, location: "Near Metairie", latitude: 29.98,
  longitude: -90.15, parish: "Jefferson", quotes_close_at: "2099-01-03T00:00:00Z", created_at: "2098-12-30T00:00:00Z",
  my_quote_id: null, my_quote_status: null,
};

const showOnly = (args: Partial<Parameters<typeof buildJobFilterSections>[0]>) => {
  const sections = buildJobFilterSections({
    selectedCategory: "all", setSelectedCategory: () => {}, sortBy: "newest", setSortBy: () => {},
    expiresWithin: "all", setExpiresWithin: () => {}, boostedOnly: false, setBoostedOnly: () => {},
    urgentOnly: false, setUrgentOnly: () => {}, ...args,
  } as Parameters<typeof buildJobFilterSections>[0]);
  const s = sections.find((x) => x.key === "show-only");
  return render(<MemoryRouter>{s?.content}</MemoryRouter>);
};

describe('the "Wants Quotes" filter in Jobs browse (owner answer 12)', () => {
  it("the filter sheet shows the row only when the page passes its toggle", () => {
    const off = showOnly({});
    expect(off.queryByRole("switch", { name: /Wants Quotes/ })).toBeNull();
    off.unmount();
    const toggle = vi.fn();
    showOnly({ wantsQuotes: false, onToggleWantsQuotes: toggle });
    fireEvent.click(screen.getByRole("switch", { name: /Wants Quotes/ }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("lists open quote requests with Send a quote, and Show all jobs leaves the filter", async () => {
    state.rows = [REQ];
    const leave = vi.fn();
    wrap(<WantsQuotesFeed onShowAllJobs={leave} />);
    expect(await screen.findByText("Paint the fence")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Send a quote" }).getAttribute("href")).toBe("/quotes/send/r1");
    fireEvent.click(screen.getByRole("button", { name: "Show all jobs" }));
    expect(leave).toHaveBeenCalledTimes(1);
  });

  it("says so when nobody wants quotes", async () => {
    state.rows = [];
    wrap(<WantsQuotesFeed onShowAllJobs={() => {}} />);
    expect(await screen.findByText("No open requests right now")).toBeTruthy();
  });

  it("the Dashboard offers it only behind the switch, swaps the feed, and steps the map aside", () => {
    const d = src("src/pages/home/Dashboard.tsx");
    expect(d).toContain('const quotesOn = useFeature("quotes");');
    expect(d).toContain("const wantsQuotes = quotesOn && wantsQuotesPicked;");
    expect(d).toContain("onToggleWantsQuotes={quotesOn ? toggleWantsQuotes : undefined}");
    expect(d).toMatch(/\{wantsQuotes \? \(\s*<Suspense fallback=\{[^\n]*\}>\s*<WantsQuotesFeed /);
    // Its own lazy chunk: the quotes reader never rides a signed-in first screen.
    expect(d).toContain('const WantsQuotesFeed = lazy(() => import("@/components/quotes/WantsQuotesFeed")');
    expect(d).not.toMatch(/^import \{ WantsQuotesFeed \}/m);
    expect(d).toContain("{isWebDesktop && mapVisible && !feedShowingLoadError && !wantsQuotes && (");
    // Not a job read: quote requests come from their own reader.
    expect(src("src/components/quotes/WantsQuotesFeed.tsx")).toContain("fetchOpenQuoteRequests");
  });
});
