/**
 * G1 (whole-app audit 1123, repeat of 1122 #1 High): guest Jobs on the web (/browse) had no search icon, no Filters
 * and no job count; search showed only when the link came with ?q=. Member Browse has all three. The guest web page
 * now draws member Browse's header row: "N open jobs", then the SAME search icon and Filters button
 * (BrowseTasksActions) on the SAME filter state, and the Filters sheet opens. Nothing on it is a signed-in action.
 * Mounts the real page with every read answering a fixed list (never prod).
 *
 * @mutate src/pages/home/DashboardGuest.tsx |     {!isNativePlatform && <GuestBrowseHeaderRow |     {false && <GuestBrowseHeaderRow
 * @mutate src/pages/home/GuestBrowseHeaderRow.tsx |         <BrowseTasksActions filters={filters} filtersButtonRef={filtersButtonRef} /> |         {null}
 * @mutate src/pages/home/GuestBrowseHeaderRow.tsx |           {countLabel} |           {null}
 * @mutate src/pages/home/GuestBrowseHeaderRow.tsx |       {filters.searchOpen ? ( |       {false ? (
 * @mutate src/pages/home/GuestBrowseHeaderRow.tsx |   if (readCount >= GUEST_JOBS_LIMIT) return |   if (false) return
 * @mutate vite.config.ts | \|components[\\/]ui[\\/]ScreenHeaderRow\.tsx)$/; | )$/;
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const feed = vi.hoisted(() => ({ jobs: [] as Record<string, unknown>[] }));

vi.mock("@/integrations/supabase/client", () => {
  const done = { data: [], count: 0, error: null };
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, k) => (k === "then" ? (r: (v: typeof done) => unknown) => Promise.resolve(done).then(r) : () => chain),
  });
  return { supabase: { from: () => chain, rpc: () => chain, auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, channel: () => chain, removeChannel: () => {} } };
});
vi.mock("@/pages/home/fetchGuestJobs", () => ({ fetchGuestJobs: async () => feed.jobs, useBrowseShellHandoff: () => {} }));
vi.mock("@/pages/home/useGuestSessionCheck", () => ({ useGuestSessionCheck: () => true }));
vi.mock("@/pages/home/useGuestPosterEnrichment", () => ({ useGuestPosterEnrichment: (jobs: unknown[]) => ({ jobs, enrichmentSettled: true }) }));
vi.mock("@/components/BrowseMap", () => ({ BrowseMap: () => null }));

import DashboardGuest from "@/pages/home/DashboardGuest";
import { GUEST_JOBS_LIMIT } from "@/lib/guestJobsQuery";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const job = (i: number) => ({
  id: `j${i}`, title: `SEED Job number ${i}`, description: "x", category: i % 2 ? "cleaning" : "yard_work", budget: 50 + i,
  urgent_fee: 0, location: "Lafayette, LA", parish: "Lafayette", status: "open", created_at: new Date(Date.now() - i * 60_000).toISOString(),
  date_needed: null, start_time: null, is_flexible_schedule: true, is_group_job: false, helpers_needed: 1, customer_id: `p${i}`,
  expires_at: null, boost_expires_at: null, pricing_mode: "fixed", photos: [],
});

async function mount(path = "/browse") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <DashboardGuest />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
  return utils;
}
const row = () => document.querySelector("[data-guest-browse-header]") as HTMLElement | null;

describe("guest /browse on the web has member Browse's header row (G1)", () => {
  beforeEach(() => { feed.jobs = [job(1), job(2), job(3)]; });

  it("shows the count, a search icon and Filters, before any search", async () => {
    await mount();
    const header = row();
    expect(header, "no header row on guest /browse").not.toBeNull();
    expect(header!.textContent).toContain("3 open jobs");
    expect(within(header!).getByRole("button", { name: "Search jobs" })).toBeTruthy();
    expect(within(header!).getByRole("button", { name: "Filters" })).toBeTruthy();
    // Floor: the list itself rendered the three jobs the count names.
    expect(screen.getAllByText(/SEED Job number/).length).toBeGreaterThan(2);
  });

  it("the search icon opens the field, focused, and it filters the same list", async () => {
    await mount();
    fireEvent.click(within(row()!).getByRole("button", { name: "Search jobs" }));
    const input = screen.getByRole("combobox", { name: "Search jobs" }) as HTMLInputElement;
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "number 2" } });
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(screen.queryByText("SEED Job number 1")).toBeNull();
    expect(screen.getAllByText("SEED Job number 2").length).toBeGreaterThan(0);
  });

  it("Filters opens the filter sheet", async () => {
    await mount();
    const filters = within(row()!).getByRole("button", { name: "Filters" });
    fireEvent.click(filters);
    expect(filters.getAttribute("aria-expanded")).toBe("true");
  });

  it("one job reads '1 open job'; a full read says 'N+' instead of claiming a total", async () => {
    feed.jobs = [job(1)];
    const first = await mount();
    expect(row()!.textContent).toContain("1 open job");
    expect(row()!.textContent).not.toContain("1 open jobs");
    first.unmount();
    feed.jobs = Array.from({ length: GUEST_JOBS_LIMIT }, (_, i) => job(i + 1));
    await mount();
    expect(row()!.textContent).toContain(`${GUEST_JOBS_LIMIT}+ open jobs`);
  });

  it("no signed-in action in the row: no saved jobs, no save-search", async () => {
    await mount();
    const names = within(row()!).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    expect(names).toEqual(["Search jobs", "Filters"]);
  });
});

describe("the header row's code stays off other screens' first load (G1, nothing slow)", () => {
  it("ScreenHeaderRow rides outside the guest-browse chunk group (in it, /gift-guides/:slug went 313 -> 390 KB gz)", () => {
    const vite = readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf8");
    const skips = /const BROWSE_GROUP_SKIPS = (\/.*\/);/.exec(vite)?.[1];
    expect(skips).toBeTruthy();
    const skip = new Function(`return ${skips}`)() as RegExp;
    expect(skip.test("/r/src/components/ui/ScreenHeaderRow.tsx")).toBe(true);
    // Floor: the list still holds the skips it had (pull-to-refresh among them).
    expect(skip.test("/r/src/components/PullToRefreshWrapper.tsx")).toBe(true);
  });
});
