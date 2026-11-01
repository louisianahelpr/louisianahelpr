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
 * @mutate src/components/declutter/DeclutterGuest.tsx |       {!barShown && <GuestBrand />}\n      <p className="min-w-0 flex-1 basis-48 text-sm"> |       <p className="min-w-0 flex-1 basis-48 text-sm">
 * Lead 10-31 (AUD31-67 follow-up): at desktop width the guest top bar carries the logo, Log in and Sign up, so the
 * Browse join line keeps only its message there; and a guest's empty Browse says "Sign up to sell", not "Sell something".
 * @mutate src/components/declutter/DeclutterGuest.tsx |   // AUD31-67 follow-up (lead 10-31): the desktop guest top bar has the logo and both buttons; the line stays.\n  const barShown = useIsWebDesktop(); |   const barShown = false;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |       {guest ? ( |       {false ? (
 * @mutate src/components/declutter/DeclutterBrowseView.tsx |   const wantedOn = useFeature("declutter_wanted") && member; |   const wantedOn = true;
 * @mutate src/components/declutter/DeclutterBrowseView.tsx | <Link to={`/signup?redirect=${encodeURIComponent(SELL_CHOOSER_PATH)}`}>Sign up to sell</Link> | <Link to="/signup">Sign up to sell</Link>
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
const state = { desktop: true, items: [item(1), item(2)] };

vi.mock("@/lib/declutter/api", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/api")>()),
  fetchLiveItems: async () => state.items,
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
  state.items = [item(1), item(2)];
});

describe("BUY-16: guests browse Declutter", () => {
  it("/declutter lets a signed-out visitor through (DeclutterGate then decides), as the item page does", () => {
    const app = blankComments(readFileSync("src/App.tsx", "utf8"));
    expect(app.length).toBeGreaterThan(5000);
    const route = app.split("\n").find((l) => l.includes('path="/declutter"'));
    expect(route).toBeDefined();
    expect(route).toContain("<DeclutterGuestOrMember><DeclutterPage /></DeclutterGuestOrMember>");
    expect(route).not.toContain("ProtectedRoute");
  });

  it("a guest gets Browse alone, a sign-up line that comes back here, and no member-only control or read", async () => {
    // Phone width: no guest top bar, so the line carries the logo and both buttons.
    state.desktop = false;
    show(<DeclutterHome />);
    expect(await screen.findByText("Thing 1")).toBeInTheDocument();
    expect(screen.getByText("Thing 2")).toBeInTheDocument();
    const join = document.querySelector('[data-guest-join="browse"]') as HTMLElement;
    expect(join).not.toBeNull();
    expect(join).toHaveTextContent("Sign up to buy, make offers or sell.");
    const back = encodeURIComponent("/declutter");
    expect(within(join).getByRole("link", { name: "Sign up" })).toHaveAttribute("href", `/signup?redirect=${back}`);
    expect(within(join).getByRole("link", { name: "Log in" })).toHaveAttribute("href", `/login?redirect=${back}`);
    // AUD31-67: the brand, and a way to the rest of Louisiana Helpr.
    expect(within(join).getByRole("link", { name: "Helpr home" })).toHaveAttribute("href", "/");
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

  it("at desktop width the line keeps its message but not the logo or the buttons: the guest top bar has them (lead 10-31)", async () => {
    show(<DeclutterHome />);
    expect(await screen.findByText("Thing 1")).toBeInTheDocument();
    const join = document.querySelector('[data-guest-join="browse"]') as HTMLElement;
    expect(join).toHaveTextContent("Sign up to buy, make offers or sell.");
    expect(within(join).queryAllByRole("link")).toEqual([]);
    expect(join.querySelector("[data-guest-brand]")).toBeNull();
    // Desktop draws the map beside the list for a member; a guest still gets no map and no pins read.
    expect(screen.queryByRole("button", { name: /the map/ })).toBeNull();
    expect(screen.queryByText("THE MAP")).toBeNull();
    expect(reads).toEqual([]);
  });

  it("a guest's empty Browse offers Sign up to sell (back to the sell chooser), never Sell something; a member keeps Sell something", async () => {
    state.items = [];
    const g = show(<DeclutterHome />);
    expect(await screen.findByText("Nothing for sale near you yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign up to sell" })).toHaveAttribute("href", `/signup?redirect=${encodeURIComponent("/declutter/sell?mode=choose")}`);
    // No Wanted for a guest, so the line never offers to "say what you're looking for".
    expect(screen.getByText("Be the first to sell something.")).toBeInTheDocument();
    expect(screen.queryByText(/say what you're looking for/)).toBeNull();
    expect(screen.queryByRole("link", { name: "Sell something" })).toBeNull();
    g.unmount();
    show(<DeclutterBrowse userId="me" tabs={(h) => <div>{h.end}</div>} />);
    expect(await screen.findByText("Nothing for sale near you yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sell something" })).toHaveAttribute("href", "/declutter/sell?mode=choose");
    expect(screen.queryByRole("link", { name: "Sign up to sell" })).toBeNull();
  });

  it("a member still gets the hearts, the map and their reads (the same screen, so the guest test can fail)", async () => {
    show(<DeclutterBrowse userId="me" tabs={(h) => <div>{h.end}</div>} />);
    expect(await screen.findByRole("button", { name: "Watch Thing 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /the map/ })).toBeInTheDocument();
    // The map is a lazy chunk: on a loaded CI runner it can land after the first heart (#3864 shard 1).
    expect(await screen.findByText("THE MAP")).toBeInTheDocument();
    expect(reads).toEqual(expect.arrayContaining(["watching", "bundles"]));
  });
});
