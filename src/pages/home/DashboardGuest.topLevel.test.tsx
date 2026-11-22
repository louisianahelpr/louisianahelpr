/**
 * F019 (owner UI audit 2026-11-09, /browse at 1440 with no jobs: "Empty jobs page has a back arrow on a top-level page and
 * no link to Declutter, so a guest who finds no jobs hits a dead end"): guest /browse draws no back arrow (it is a
 * top-level page), and its no-jobs state offers "Browse Declutter while you wait". The HTML shell and the skeleton
 * draw the same header (no arrow) and the same empty state, so nothing moves at the handoff (browseShellEmptyState,
 * listArrivesInOneWave).
 *
 * Owner 11-21 REVERSED the arrow half: "needs a back button to the left of browse jobs" and "just name it jobs". The
 * page now draws the shared arrow left of its title "Jobs", named "Go to Home", always to "/"
 * (src/test/browseJobsBackAndTitle1121.test.tsx); the skeleton holds the arrow's box, inert, so nothing moves.
 * The Declutter half (no jobs -> "Browse Declutter while you wait") is unchanged.
 *
 * @mutate src/pages/home/DashboardGuest.tsx |       backLabel={tr("nav.goHome")}\n |       hideBack\n
 * @mutate src/components/dashboard/GuestEmptyStateActions.tsx |       <Button type="button" variant="link" size="sm" className="text-muted-foreground" onClick={onDeclutter}> |       <Button type="button" variant="link" size="sm" className="text-muted-foreground" onClick={onHire}>
 * @mutate src/components/GuestBrowseSkeleton.tsx | <PageHeader title={t("nav.jobs")} hideBack reserveBackSlot width="public" topInsetHandled /> | <PageHeader title={t("nav.jobs")} hideBack width="public" topInsetHandled />
 */
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";

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
import GuestBrowseSkeleton from "@/components/GuestBrowseSkeleton";

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/browse"]}>
        <Routes>
          <Route path="/browse" element={<DashboardGuest />} />
          <Route path="/declutter" element={<p>DECLUTTER</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("F019 + owner 11-21: guest /browse, a way Home left of 'Jobs', and a way on to Declutter", () => {
  it("the Go to Home arrow; with no jobs it offers Browse Declutter while you wait, which opens Declutter", async () => {
    mount();
    const declutter = await screen.findByRole("button", { name: "Browse Declutter while you wait" });
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Go to Home" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Jobs" })).toBeTruthy();
    fireEvent.click(declutter);
    expect(screen.getByText("DECLUTTER")).toBeTruthy();
  });

  it("the loading skeleton draws the same header: 'Jobs' after the arrow's held box (inert, no button)", () => {
    const html = renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><MemoryRouter><GuestBrowseSkeleton /></MemoryRouter></QueryClientProvider>);
    expect(html).toContain(">Jobs</h1>");
    expect(html).toMatch(/<div class="shrink-0" aria-hidden="true"><span class="w-11 h-11 -ml-2 block"><\/span><\/div>/);
    // The only label is the held "Jobs | Declutter" row (Jobs audit 11-21 P10), drawn invisible and aria-hidden.
    expect(html.match(/aria-label=/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/class="mb-2 invisible" aria-hidden="true" data-skeleton-section-switch=""><div[^>]*role="group" aria-label=/);
    expect(html.length).toBeGreaterThan(500);
  });
});
