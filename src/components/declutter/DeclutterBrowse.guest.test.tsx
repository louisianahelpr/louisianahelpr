/**
 * BUY-16 (audit 10-30, High). Owner 10-30: "Guests see Declutter Browse and item pages; sign up to buy or offer."
 * /declutter sent every signed-out visitor to the login wall. A guest now gets Browse alone: the listings with their
 * photos, a sign-up line on top, and none of the reads a guest is refused (watchlist hearts, saved searches, bundle
 * chips, the map's pins), nor Buying / Selling / Deliver / Wanted / Free or the settings gear.
 *
 * @mutate src/App.tsx | routeEl(<DeclutterGuestOrMember><DeclutterPage /></DeclutterGuestOrMember>) | routeEl(<ProtectedRoute><DeclutterPage /></ProtectedRoute>)
 * @mutate src/components/declutter/DeclutterHomeView.tsx |   if (isLoading) return <DeclutterHomeSkeleton />;\n  return <DeclutterGuestHome />; |   return null;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | queryFn: () => fetchWatching(userId ?? ""), enabled: member }); | queryFn: () => fetchWatching(userId ?? "") });
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |                   save={member ? { |                   save={true ? {
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const mapVisible = member && mapChoice; |   const mapVisible = mapChoice;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | queryFn: () => fetchBundleSellers(sellerIds), enabled: member && sellerIds.length > 0, | queryFn: () => fetchBundleSellers(sellerIds), enabled: sellerIds.length > 0,
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const item = (n: number) => ({
  id: `i${n}`, seller_id: "s1", status: "live", title: `Thing ${n}`, description: "", category: "furniture", condition_stars: 4, delivery_size: "small",
  price_cents: 1000, current_price_cents: 1000, area_label: "Mid City", area_lat: 30.45 + n / 100, area_lng: -91.15, created_at: "2026-10-30", live_at: "2026-10-30",
  porch_ok: true, accepts_offers: true,
});
const reads: string[] = [];
const state = { desktop: true };

vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchLiveItems: async () => [item(1), item(2)],
  fetchPhotos: async () => [],
  fetchDropStates: async () => new Map(),
  fetchWatching: async () => { reads.push("watching"); return new Set(); },
  fetchMapPins: async () => { reads.push("pins"); return new Map(); },
  setWatch: async () => "watching",
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bundle")>()),
  fetchBundleSellers: async () => { reads.push("bundles"); return new Set<string>(); },
}));
vi.mock("@/lib/declutter/bootPrefetch", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/bootPrefetch")>()),
  readFirstScreenPreview: async () => null,
}));
vi.mock("./useDeclutterOrigin", () => ({
  useDeclutterOrigin: () => ({ origin: { status: "none", zipOnFile: false }, askDevice: () => undefined, asked: false, asking: false, canAskAgain: false, deviceNote: null, zip: null }),
}));
vi.mock("@/hooks/useIsWebDesktop", () => ({ useIsWebDesktop: () => state.desktop }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false, useFeatureStatus: () => ({ on: false, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: null, profile: null, isLoading: false }) }));
vi.mock("@/components/sections/SectionScreen", () => ({
  SectionScreen: ({ children, tabs }: { children: React.ReactNode; tabs?: React.ReactNode }) => <main>{tabs}{children}</main>,
}));
vi.mock("@/components/sections/BrowseEndCard", () => ({ BrowseEndCard: () => <p>end of the list</p> }));
vi.mock("./DeclutterMap", () => ({ default: () => <p>THE MAP</p> }));

import DeclutterHome from "./DeclutterHomeView";
import { DeclutterBrowse } from "./DeclutterBrowseView";

function show(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/declutter"]}>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  reads.length = 0;
  state.desktop = true;
});

describe("BUY-16: guests browse Declutter", () => {
  it("/declutter lets a signed-out visitor through (DeclutterGate then decides), as the item page does", () => {
    const app = blankComments(readFileSync("src/App.tsx", "utf8"));
    const route = app.split("\n").find((l) => l.includes('path="/declutter"'));
    expect(route).toBeDefined();
    expect(route).toContain("<DeclutterGuestOrMember><DeclutterPage /></DeclutterGuestOrMember>");
    expect(route).not.toContain("ProtectedRoute");
  });

  it("a guest gets Browse alone, a sign-up line that comes back here, and no member-only control or read", async () => {
    show(<DeclutterHome />);
    expect(await screen.findByText("Thing 1")).toBeInTheDocument();
    expect(screen.getByText("Thing 2")).toBeInTheDocument();
    const join = document.querySelector('[data-guest-join="browse"]') as HTMLElement;
    expect(join).not.toBeNull();
    expect(join).toHaveTextContent("Sign up to buy, make offers or sell.");
    const back = encodeURIComponent("/declutter");
    expect(within(join).getByRole("link", { name: "Sign up" })).toHaveAttribute("href", `/signup?redirect=${back}`);
    expect(within(join).getByRole("link", { name: "Log in" })).toHaveAttribute("href", `/login?redirect=${back}`);
    // Browse is the only tab; no gear.
    for (const tab of ["Buying", "Selling", "Deliver", "Free"]) expect(screen.queryByRole("tab", { name: new RegExp(`^${tab}`) })).toBeNull();
    expect(screen.queryByRole("link", { name: /settings/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /settings/i })).toBeNull();
    // No heart, no map, and none of their reads.
    expect(screen.queryByRole("button", { name: /^Watch Thing/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /the map/ })).toBeNull();
    expect(screen.queryByText("THE MAP")).toBeNull();
    expect(reads).toEqual([]);
  });

  it("a member still gets the hearts, the map and their reads (the same screen, so the guest test can fail)", async () => {
    show(<DeclutterBrowse userId="me" tabs={(h) => <div>{h.end}</div>} />);
    expect(await screen.findByRole("button", { name: "Watch Thing 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /the map/ })).toBeInTheDocument();
    expect(screen.getByText("THE MAP")).toBeInTheDocument();
    expect(reads).toEqual(expect.arrayContaining(["watching", "bundles"]));
  });
});
