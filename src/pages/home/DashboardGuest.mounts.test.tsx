/**
 * The guest Browse page really mounts its map in the map view, and not in the list view.
 *
 * Q1816 #2894: once the vacuity mount scanner followed lazy() edges and the tests' dynamic imports
 * (2026-11-05), BrowseMap and DashboardTitleBar read as isolated mounts: each has its own tests, but no
 * test rendered DashboardGuest, the page that mounts them. Here it is rendered with only its data hooks
 * stubbed (no jobs, a known guest). NOT asserted here: the native branch's DashboardTitleBar title card
 * (an isNativePlatform getter mock did not reach the page's binding; next step for Builder 2).
 *
 * @mutate src/pages/home/DashboardGuest.tsx |       <BrowseMap\n |       <BrowseMapGone\n
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const view = vi.hoisted(() => ({ current: "list" as "list" | "map", native: false }));

vi.mock("@/lib/nativeInit", async (orig) => ({
  ...(await orig<typeof import("@/lib/nativeInit")>()),
  get isNativePlatform() {
    return view.native;
  },
}));
// Any other read on the page (the feed's count) answers empty, never prod.
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
vi.mock("@/hooks/usePersistedBrowseView", () => ({ usePersistedBrowseView: () => [view.current, () => {}] }));
vi.mock("@/components/BrowseMap", () => ({ BrowseMap: () => <div data-testid="browse-map-stub" /> }));

import DashboardGuest from "./DashboardGuest";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/browse"]}>
        <DashboardGuest />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardGuest mounts its children", () => {
  beforeEach(() => {
    view.current = "list";
    view.native = false;
  });

  it("the map view draws BrowseMap", async () => {
    view.current = "map";
    mount();
    expect(await screen.findByTestId("browse-map-stub")).toBeTruthy();
  });

  it("the list view does not", async () => {
    mount();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("browse-map-stub")).toBeNull();
  });
});
