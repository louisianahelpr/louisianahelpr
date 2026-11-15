/**
 * /declutter/settings ARRIVES IN ONE PAINT (Q169; prod-audit 43691657529 on 2026-11-15 page-settle: CLS 0.38 at 375, 0.25 at 1440).
 *
 * Each card read its own data and grew when it landed: pickup places went from a "Loading" row to the full card and
 * pushed Meet spots down 281px, then the police-spot suggestions, the meetup-times card and listing defaults landed
 * one by one. The page now holds its bones until every read the cards make has answered, then paints them together.
 *
 * Each read here is held until the test lets it go, in turn; the page must show no card until the LAST one answers.
 * The two dependent reads (the last listing's area while no place is saved, the delivery terms under a ticked
 * "I'll deliver") are held too, so a gate that forgets them goes red.
 *
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx |   if (!ready) return <DeclutterSettingsSkeleton />;\n |
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx |   const primary = settled(places) && settled(defaults); |   const primary = settled(places);
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx | settled(windows) && settled(spots) && settled(suggestions) && settled(items) | settled(windows) && settled(spots) && settled(items)
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx | settled(windows) && settled(spots) && settled(suggestions) && settled(items) | settled(windows) && settled(spots) && settled(suggestions)
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx | && settled(bundle, bundleOn) && settled(last, noPlaces) | && settled(bundle, bundleOn)
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx | && settled(delivery, delivers); | ;
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx | settled(windows) && settled(spots) && settled(suggestions) | settled(spots) && settled(suggestions)
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx | settled(windows) && settled(spots) && settled(suggestions) | settled(windows) && settled(suggestions)
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx | && settled(bundle, bundleOn) && | &&
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DeclutterSettingsPage from "@/pages/declutter/DeclutterSettingsPage";

type Held = { promise: Promise<unknown>; resolve: (v: unknown) => void };
const held = new Map<string, Held>();
function hold(name: string): Promise<unknown> {
  let h = held.get(name);
  if (!h) {
    let resolve!: (v: unknown) => void;
    const promise = new Promise((r) => { resolve = r; });
    h = { promise, resolve };
    held.set(name, h);
  }
  return h.promise;
}
const answers: Record<string, unknown> = {};

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => true, useFeatureStatus: () => ({ on: true, settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/sellerDefaults")>()), fetchSellerDefaults: () => hold("defaults") }));
vi.mock("@/lib/declutter/bundle", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/bundle")>()), fetchBundleRule: () => hold("bundle") }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/sellerDelivery")>()), fetchMySellerDelivery: () => hold("delivery") }));
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/api")>()), fetchMyPickupWindows: () => hold("windows"), fetchMyItems: () => hold("items") }));
vi.mock("@/lib/declutter/meetup", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/meetup")>()), fetchMyMeetupSpots: () => hold("spots"), fetchMeetupSuggestions: () => hold("suggestions") }));
vi.mock("@/lib/declutter/lastSetup", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/lastSetup")>()), fetchLastSetup: () => hold("last") }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/porchPlaces")>()), fetchMyPorchPlaces: () => hold("places") }));

const DEFAULTS = { keepUp: true, acceptsOffers: true, acceptsTrades: false, drops: false, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["porch_pickup", "meetup", "seller_delivery"] };
const DELIVERY = { enabled: false, rate_cents: null, free_over_cents: null, radius_miles: 10, windows: [], days_off: [], items_off: [], rules: null };

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/declutter/settings"]}>
        <DeclutterSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); });
async function release(name: string) {
  await flush();
  // A dependent read may not be asked yet (the last listing's area waits on places): its answer is then ready when it is.
  void hold(name);
  await act(async () => { held.get(name)!.resolve(answers[name]); });
  await flush();
}
const painted = () => screen.queryByTestId("declutter-settings") !== null
  || screen.queryByText("Pickup places") !== null
  || document.querySelector("[data-testid='sell-meetup-spots'],[data-listing-defaults],[data-porch-places-card]") !== null;

beforeEach(() => {
  held.clear();
  Object.assign(answers, {
    places: [], defaults: DEFAULTS, windows: [], spots: [], suggestions: [{ id: "s1", name: "Police Dept", address: "1 Main St, Baton Rouge", area: "Baton Rouge", lat: 30, lng: -91 }],
    items: [], bundle: null, last: { areaLabel: "Mid City" }, delivery: DELIVERY,
  });
});

// Every read the cards make, in an order that leaves the dependent ones last.
const ORDER = ["places", "defaults", "windows", "spots", "suggestions", "items", "bundle", "delivery", "last"];

describe("/declutter/settings paints every card at once", () => {
  for (const lastOne of ORDER) {
    it(`shows no card while "${lastOne}" is still out`, async () => {
      open();
      for (const name of ORDER.filter((n) => n !== lastOne)) {
        await release(name);
        expect(painted(), `painted before "${lastOne}" answered (after "${name}")`).toBe(false);
      }
      await release(lastOne);
      await waitFor(() => expect(painted()).toBe(true));
      expect(screen.getByTestId("declutter-settings")).toBeTruthy();
      // Everything is there in the first paint: places, meet spots with a suggestion, meetup times, defaults.
      expect(document.querySelector("[data-porch-places-card]")).not.toBeNull();
      expect(document.querySelector("[data-meetup-suggestions]")).not.toBeNull();
      expect(document.querySelector("[data-meetup-times-card]")).not.toBeNull();
      expect(document.querySelector("[data-listing-defaults]")).not.toBeNull();
      expect(document.querySelector("[data-pickup-now]")).not.toBeNull();
    });
  }

  it("covers every read (floor)", () => {
    expect(ORDER.length).toBeGreaterThan(8);
  });
});
