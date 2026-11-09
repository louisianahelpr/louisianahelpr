/**
 * F070 (owner UI audit 11-09; lead decision 11-09, "the audit wins", superseding the owner's 09-11 removal for this
 * case): a guest who arrives on /browse WITH a search (/browse?q=yard, from the landing page's search) gets a search
 * field holding that word above the list, so a search with no results can try another word instead of only
 * "Clear search". Plain /browse keeps no search (owner 09-11). The field does not take focus on arrival.
 *
 * @mutate src/pages/home/DashboardGuest.tsx |   const [arrivedWithSearch] = useState(() => !!filters.searchQuery); |   const [arrivedWithSearch] = useState(() => false);
 * @mutate src/pages/home/DashboardGuest.tsx |     {shownSearch && <BrowseSearchBar | {false && <BrowseSearchBar
 * @mutate src/components/dashboard/browseTasksToolbar/BrowseSearchBar.tsx |     if (!el \|\| !autoFocus) return; |     if (!el) return;
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Every read on the page answers empty, never prod (the same stubs as DashboardGuest.mounts.test.tsx).
vi.mock("@/integrations/supabase/client", () => {
  const done = { data: [], count: 0, error: null };
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_t, k) => (k === "then" ? (r: (v: typeof done) => unknown) => Promise.resolve(done).then(r) : () => chain),
  });
  return { supabase: { from: () => chain, rpc: () => chain, auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) }, channel: () => chain, removeChannel: () => {} } };
});
vi.mock("./fetchGuestJobs", () => ({ fetchGuestJobs: async () => [], useBrowseShellHandoff: () => {} }));
vi.mock("./useGuestSessionCheck", () => ({ useGuestSessionCheck: () => true }));
vi.mock("./useGuestPosterEnrichment", () => ({ useGuestPosterEnrichment: (jobs: unknown[]) => ({ jobs, enrichmentSettled: true }) }));
vi.mock("@/components/BrowseMap", () => ({ BrowseMap: () => null }));

import DashboardGuest from "./DashboardGuest";

function mount(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <DashboardGuest />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const field = () => screen.queryByRole("combobox", { name: "Search jobs" }) as HTMLInputElement | null;

describe("guest /browse keeps a search field for a visit that came with a search (F070)", () => {
  it("/browse?q=yard shows the field with the word in it, unfocused, and it takes another word", async () => {
    mount("/browse?q=yard");
    await new Promise((r) => setTimeout(r, 50));
    const input = field();
    expect(input, "no search field on /browse?q=yard").not.toBeNull();
    expect(input!.value).toBe("yard");
    expect(document.activeElement).not.toBe(input);
    fireEvent.change(input!, { target: { value: "" } });
    // Emptied, it stays: the point is trying another word.
    expect(field()).not.toBeNull();
    fireEvent.change(field()!, { target: { value: "fence" } });
    expect(field()!.value).toBe("fence");
  });

  it("plain /browse still has no search field (owner 09-11)", async () => {
    mount("/browse");
    await new Promise((r) => setTimeout(r, 50));
    expect(field()).toBeNull();
    expect(screen.queryAllByRole("searchbox").length + screen.queryAllByRole("combobox").length).toBe(0);
  });
});
