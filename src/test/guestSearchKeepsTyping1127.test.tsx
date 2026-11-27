/**
 * Polish audit 11-27 #8 (HIGH, a real bug): on signed-out /browse, typing "clean" left "c". The first letter wrote
 * ?q=c (useSearchParamMirror, replace), every replace makes a new location.key, and RoutePageTransition keys the page
 * by it, so the whole guest page remounted: the field came back holding "c", unfocused, and the next letters went
 * nowhere. Signed-in /jobs is not inside RoutePageTransition, which is why members could search. The mirror's write
 * now carries KEEP_PAGE (src/lib/keepPage.ts), the flag a within-page step already uses to keep the page mounted.
 * Mounts the real page inside the real RoutePageTransition with every read answering a fixed list (never prod).
 *
 * @mutate src/hooks/useSearchParamMirror.ts | setSearchParamsRef.current(next, { replace: true, state: withKeepPage(locationStateRef.current) }); | setSearchParamsRef.current(next, { replace: true });
 */
import { describe, it, expect, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", () => {
  const done = { data: [], count: 0, error: null };
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, k) => (k === "then" ? (r: (v: typeof done) => unknown) => Promise.resolve(done).then(r) : () => chain),
  });
  return { supabase: { from: () => chain, rpc: () => chain, auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, channel: () => chain, removeChannel: () => {} } };
});
const jobs = vi.hoisted(() => [1, 2, 3].map((i) => ({
  id: `j${i}`, title: i === 2 ? "SEED Clean the kitchen" : `SEED Mow lawn ${i}`, description: "x", category: "yard_work", budget: 50 + i,
  urgent_fee: 0, location: "Lafayette, LA", parish: "Lafayette", status: "open", created_at: new Date(Date.now() - i * 60_000).toISOString(),
  date_needed: null, start_time: null, is_flexible_schedule: true, is_group_job: false, helpers_needed: 1, customer_id: `p${i}`,
  expires_at: null, boost_expires_at: null, pricing_mode: "fixed", photos: [],
})));
vi.mock("@/pages/home/fetchGuestJobs", () => ({ fetchGuestJobs: async () => jobs, useBrowseShellHandoff: () => {} }));
vi.mock("@/pages/home/useGuestSessionCheck", () => ({ useGuestSessionCheck: () => true }));
vi.mock("@/pages/home/useGuestPosterEnrichment", () => ({ useGuestPosterEnrichment: (j: unknown[]) => ({ jobs: j, enrichmentSettled: true }) }));
vi.mock("@/components/BrowseMap", () => ({ BrowseMap: () => null }));

import DashboardGuest from "@/pages/home/DashboardGuest";
import { RoutePageTransition } from "@/components/RoutePageTransition";

let lastSearch = "";
function Where() { lastSearch = useLocation().search; return null; }

const tick = (ms: number) => act(async () => { await new Promise((r) => setTimeout(r, ms)); });

describe("signed-out Jobs search keeps every letter (polish 11-27 #8)", () => {
  it('typing "clean" one letter at a time leaves "clean" in the field, focused, and ?q=clean', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/browse"]}>
          <Where />
          <Routes>
            <Route path="/browse" element={<RoutePageTransition><DashboardGuest /></RoutePageTransition>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await tick(400);
    const header = document.querySelector("[data-guest-browse-header]") as HTMLElement;
    fireEvent.click(within(header).getByRole("button", { name: "Search jobs" }));
    await tick(50);
    let typed = "";
    for (const ch of "clean") {
      const input = screen.getByRole("combobox", { name: "Search jobs" }) as HTMLInputElement;
      expect(document.activeElement, `focus lost before "${ch}" (field holds "${input.value}")`).toBe(input);
      typed += ch;
      fireEvent.change(input, { target: { value: typed } });
      await tick(30);
    }
    const input = screen.getByRole("combobox", { name: "Search jobs" }) as HTMLInputElement;
    expect(input.value).toBe("clean");
    expect(document.activeElement).toBe(input);
    expect(new URLSearchParams(lastSearch).get("q")).toBe("clean");
    // Floor: the search filtered the list the field drives.
    expect(screen.getAllByText("SEED Clean the kitchen").length).toBeGreaterThan(0);
    expect(screen.queryByText("SEED Mow lawn 1")).toBeNull();
  });
});
