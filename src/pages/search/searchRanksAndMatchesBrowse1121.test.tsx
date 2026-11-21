/**
 * Jobs audit 11-21 (P15): searching "clean" led with Declutter description hits (a duck lamp, zip pouches) above Jobs,
 * printed job prices in rust (ink on Browse), drew Cleaning's tile brown (light blue on Browse) and named the parish
 * where Browse names the town.
 *   1. a title hit older than the newest 20 still leads Declutter (the title-only read);
 *   2. the section with more title matches leads; a tie keeps Jobs first;
 *   3. a job row: Browse's tinted category tile, ink price, the town.
 *
 * @mutate src/pages/search/SearchPage.tsx | const byTitle = ((unwrap(titled) ?? []) as ItemHit[]).filter((it) => matchesSearch(q, { title: it.title })); | const byTitle = [] as ItemHit[];
 * @mutate src/pages/search/SearchPage.tsx |         {jobsFirst ? jobsGroup : declutterGroup}\n        {jobsFirst ? declutterGroup : jobsGroup} |         {declutterGroup}\n        {jobsGroup}
 * @mutate src/pages/search/SearchPage.tsx | style={{ color: priceInk ? "hsl(var(--ink-deep))" : "hsl(var(--burnt-sienna))" }} | style={{ color: "hsl(var(--burnt-sienna))" }}
 * @mutate src/pages/search/SearchPage.tsx |   const town = getCity(j.location ?? ""); |   const town = "";
 * @mutate src/pages/search/SearchPage.tsx | style={{ background: tint.background }} aria-hidden data-search-job-tile=""> | aria-hidden data-search-job-tile="">
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

const state = vi.hoisted(() => ({
  jobs: [] as Record<string, unknown>[],
  wide: [] as Record<string, unknown>[],
  titled: [] as Record<string, unknown>[],
  wideCount: 0,
}));

vi.mock("@/hooks/useFeature", () => ({ useFeatureStatus: (key: string) => ({ on: key === "declutter", settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: null }) }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => 0, useFirstPayoutFeeDollars: () => 0 }));
vi.mock("@/hooks/usePageTitle", () => ({ usePageTitle: () => undefined }));
vi.mock("@/lib/userBlocks", () => ({ getBlockedUserIds: async () => new Set<string>() }));
vi.mock("@/components/AppPage", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/savedSearches/SaveSearchButton", () => ({ SaveSearchButton: () => null }));
vi.mock("@/lib/declutter/api", () => ({ fetchPhotos: async () => [], photoPublicUrl: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const rows = (table: string) => {
    let filter = "";
    const b: Record<string, unknown> = {};
    for (const m of ["select", "ilike", "not", "in", "order", "limit", "eq"]) b[m] = () => b;
    b.or = (f: string) => { filter = f; return b; };
    b.then = (res: (v: unknown) => unknown) => {
      // The title-only read names no description column (searchOrFilter with title three times).
      const out = table === "declutter_items"
        ? filter.includes("description") ? { data: state.wide, error: null, count: state.wideCount } : { data: state.titled, error: null, count: state.titled.length }
        : table === "open_jobs_browse" ? { data: state.jobs, error: null, count: state.jobs.length } : { data: [], error: null, count: 0 };
      return Promise.resolve(out).then(res);
    };
    return b;
  };
  return { supabase: { from: (t: string) => rows(t), rpc: async () => ({ data: [], error: null }) } };
});

import SearchPage from "./SearchPage";

const item = (id: string, title: string, description: string | null) => ({ id, title, description, category: "home", current_price_cents: null, price_cents: 1000, area_label: null });
const job = (id: string, title: string) => ({ id, title, category: "cleaning", budget: 100, pricing_mode: "fixed", parish: "Iberia", location: "New Iberia, LA", date_needed: null, urgent_fee: 0, is_group_job: false, helpers_needed: 1, customer_id: "u1" });

function open() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/search?q=clean"]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.jobs = [job("j1", "Clean my kitchen"), job("j2", "Deep clean a house")];
  // The newest 20 wide hits: description-only matches. The one title hit is older, so only the title read finds it.
  state.wide = [item("i1", "Vintage duck touch lamp", "Wipe clean."), item("i2", "Zippered pouches", "Clean, no stains.")];
  state.wideCount = 70;
  state.titled = [item("i9", "Carpet clean machine", null)];
});

describe("audit 11-21 P15: search ranks title hits and draws jobs like Browse", () => {
  it("a Declutter title hit older than the newest 20 still leads its section", async () => {
    open();
    const group = await screen.findByRole("region", { name: "Declutter" });
    const names = within(group).getAllByRole("link").map((a) => a.textContent ?? "");
    expect(names.length).toBeGreaterThan(0);
    expect(names[0]).toMatch(/Carpet clean machine/);
  });

  it("the section with more title matches leads (Jobs 2, Declutter 1)", async () => {
    open();
    await screen.findByRole("region", { name: "Declutter" });
    const order = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(order.indexOf("Jobs")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("Jobs")).toBeLessThan(order.indexOf("Declutter"));
  });

  it("Declutter leads when it has more title matches", async () => {
    state.jobs = [job("j1", "Clean my kitchen")];
    state.titled = [item("i9", "Carpet clean machine", null), item("i8", "Clean rug", null)];
    open();
    await screen.findByRole("region", { name: "Jobs" });
    const order = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(order.indexOf("Declutter")).toBeLessThan(order.indexOf("Jobs"));
  });

  it("a job row: Browse's tinted tile, an ink price and the town", async () => {
    open();
    const group = await screen.findByRole("region", { name: "Jobs" });
    const row = within(group).getAllByRole("link")[0];
    const tile = row.querySelector("[data-search-job-tile]") as HTMLElement;
    expect(tile).toBeTruthy();
    expect(tile.style.background).toContain("--cat-tint-");
    expect(row.textContent).toContain("New Iberia");
    expect(row.textContent).not.toContain("Iberia Parish");
    const price = Array.from(row.querySelectorAll("span")).find((s) => /^\$\d/.test(s.textContent ?? "")) as HTMLElement;
    expect(price.style.color).toBe("hsl(var(--ink-deep))");
  });
});
