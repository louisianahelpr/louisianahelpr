/**
 * /declutter/settings (owner 2026-10-30: a settings gear like Jobs): pickup places, then listing defaults on the
 * account (with the bundle discount and, under the "I'll deliver" tick, the delivery terms; owner 2026-10-31), then a
 * way to the Declutter notifications.
 * The gear itself and Selling's one row: sellingDash.test.tsx.
 *
 * @mutate src/App.tsx |       <Route path="/declutter/settings" element= |       <Route path="/declutter/settings-old" element=
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx |         <MeetupTimesCard userId={user.id} />\n |         <MeetupTimesCard userId={user.id} />\n        <section aria-label="Pickup times" />\n
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | {sellerDeliveryOpen && draft.handovers.includes("seller_delivery") && <SellerDeliveryDetails />} | {sellerDeliveryOpen && <SellerDeliveryDetails />}
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | {sellerDeliveryOpen && draft.handovers.includes("seller_delivery") && <SellerDeliveryDetails />} |
 * @mutate src/components/declutter/SellerDeliverySettings.tsx |       {!embedded && (\n      <div className="flex items-center justify-between gap-3"> |       {(\n      <div className="flex items-center justify-between gap-3">
 * @mutate src/components/declutter/SellerDeliverySettings.tsx |   const [enabled, setEnabled] = useState(embedded ? true : current.enabled); |   const [enabled, setEnabled] = useState(current.enabled);
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx |         <SellPorchPlaces card />\n |
 * @mutate src/components/declutter/SellPorchPlaces.tsx |     return card ? inCard(<><span className="block text-sm font-semibold">Pickup places</span><span className="block text-xs text-muted-foreground">Loading…</span></>) : null; |     return null;
 * @mutate src/components/declutter/SellPorchPlaces.tsx | (card\n    ? <section className="rounded-2xl border border-border bg-card px-4 py-3" aria-label="Pickup places" data-porch-places-card="">{body}</section>\n    : body) | body
 * @mutate src/pages/declutter/DeclutterSettingsPage.tsx |             to="/profile?tab=notifications&show=declutter"\n |             to="/profile?tab=notifications"\n
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | setWays={(w) => change({ handovers: w })} onSettingsPage /> | setWays={(w) => change({ handovers: w })} />
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |   if (saved.isError) return <ErrorState variant="inline" title="We couldn't load your listing defaults." body={declutterErrorMessage(saved.error)} onRetry={() => void saved.refetch()} />;\n |
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       if (!done) {\n        toast.error("We couldn't save your listing defaults yet. Try again in a little while.");\n        return;\n      }\n |
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | disabled={save.isPending \|\| noWay \|\| !unsaved} | disabled={save.isPending \|\| !unsaved}
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | return [...new Set([...FLOOR_CHOICES, current])].sort | return [...FLOOR_CHOICES].sort
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |       qc.setQueryData(["declutter", "seller-defaults", userId], draft);\n |
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx | const shown = SELLER_WAYS.filter((w) => w !== "seller_delivery" \|\| sellerDeliveryOpen); | const shown = SELLER_WAYS;
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |   useLeaveWarning(unsaved && !save.isPending);\n |
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |     if (pending.current) toast( |     if (false) toast(
 * @mutate src/components/declutter/DeclutterListingDefaults.tsx |     if (!unsaved) return;\n |
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { SellerDefaults } from "@/lib/declutter/sellerDefaults";
import DeclutterSettingsPage from "@/pages/declutter/DeclutterSettingsPage";

const state = {
  saved: null as SellerDefaults | null,
  readError: false,
  saveResult: true,
  saves: [] as SellerDefaults[],
  places: [] as unknown[] | "not_deployed",
  features: { declutter: true, declutter_seller_delivery: true } as Record<string, boolean>,
};

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: (k: string) => !!state.features[k], useFeatureStatus: (k: string) => ({ on: !!state.features[k], settled: true }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/hooks/useAuthReady", () => ({ useAuthReady: () => ({ user: { id: "u1" }, isReady: true }) }));
vi.mock("@/lib/declutter/sellerDefaults", async (orig) => ({
  ...(await orig<typeof import("@/lib/declutter/sellerDefaults")>()),
  fetchSellerDefaults: async () => {
    if (state.readError) throw new Error("offline");
    return state.saved;
  },
  saveSellerDefaults: async (_u: string, d: SellerDefaults) => {
    state.saves.push(d);
    return state.saveResult;
  },
}));
vi.mock("@/lib/declutter/bundle", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/bundle")>()), fetchBundleRule: async () => null }));
vi.mock("@/lib/declutter/sellerDelivery", async (orig) => {
  const real = await orig<typeof import("@/lib/declutter/sellerDelivery")>();
  return { ...real, fetchMySellerDelivery: async () => ({ enabled: false, rate_cents: null, free_over_cents: null, radius_miles: 10, windows: [], days_off: [], items_off: [], rules: real.SELLER_DELIVERY_RULES }) };
});
// One mock of the module (a second vi.mock of the same path replaces the first). LEAD-OFFERS-CHOICE: fetchMyItems is
// the listings the "for all my listings" row counts (none here, so it stays hidden).
vi.mock("@/lib/declutter/api", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/api")>()), fetchMyPickupWindows: async () => [], fetchMyItems: async () => [] }));
vi.mock("@/lib/declutter/porchPlaces", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/porchPlaces")>()), fetchMyPorchPlaces: async () => state.places }));

function open() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/declutter/settings"]}>
        <DeclutterSettingsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const save = () => screen.findByRole("button", { name: "Save" });
const radio = (group: string, name: string) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });

beforeEach(() => {
  state.saved = null;
  state.readError = false;
  state.saveResult = true;
  state.saves = [];
  state.places = [];
  state.features = { declutter: true, declutter_seller_delivery: true };
  vi.mocked(toast).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("Declutter settings", () => {
  it("is a route, declared before the item page", () => {
    const app = readFileSync("src/App.tsx", "utf8");
    const at = app.indexOf('<Route path="/declutter/settings" element=');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(app.indexOf('<Route path="/declutter/item/:id" element='));
  });

  it("holds the five areas, the notifications row going to the Notifications screen", async () => {
    open();
    await save();
    for (const name of ["Listing defaults", "Notifications"]) expect(screen.getByRole("region", { name })).toBeInTheDocument();
    // LEAD-BUNDLE-DROPDOWN / LEAD-DELIVER-TWICE (owner 2026-10-31): no "Delivery and bundles" section, no "I can deliver" row.
    expect(screen.queryByRole("region", { name: /^Delivery/ })).toBeNull();
    expect(screen.queryByRole("region", { name: "Your delivery" })).toBeNull();
    expect(screen.queryByText("I can deliver")).toBeNull();
    // LEAD-PLACE-TIMES (owner 2026-10-31): no separate Pickup times card; each pickup place has its own hours.
    expect(screen.queryByRole("region", { name: "Pickup times" })).toBeNull();
    expect(await screen.findByRole("group", { name: "Bundle discount" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Declutter notifications/ })).toHaveAttribute("href", "/profile?tab=notifications&show=declutter");
  });

  it("the I'll deliver tile points nowhere: its price and times open under it while ticked, with no switch of their own", async () => {
    open();
    const box = await screen.findByRole("checkbox", { name: "I'll deliver" });
    const tile = box.closest("label")!;
    expect(tile.textContent).not.toContain("I can deliver");
    expect(tile.textContent).not.toContain("in Declutter settings");
    if (box.getAttribute("aria-checked") === "true") fireEvent.click(box);
    expect(screen.queryByRole("group", { name: "Your delivery price and times" })).toBeNull();
    fireEvent.click(box);
    const details = await screen.findByRole("group", { name: "Your delivery price and times" });
    expect(within(details).getByRole("radiogroup", { name: "Your delivery price, per order" })).toBeInTheDocument();
    expect(within(details).getByText("When you can deliver")).toBeInTheDocument();
    expect(within(details).getByRole("button", { name: "Save delivery" })).toBeInTheDocument();
    expect(within(details).queryByRole("switch", { name: "Offer delivery to buyers" })).toBeNull();
    expect(within(details).queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.click(box);
    expect(screen.queryByRole("group", { name: "Your delivery price and times" })).toBeNull();
  });

  it("no saved row: shows the app's defaults; Save stays off until something changes, then saves exactly the choices", async () => {
    open();
    const button = await save();
    expect(button).toBeDisabled();
    expect(radio("How much each evening", "5%")).toHaveAttribute("aria-checked", "true");
    expect(radio("Lowest you'll take", "50%")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radio("How much each evening", "15%"));
    fireEvent.click(radio("Lowest you'll take", "60%"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Safe meeting spot" }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await vi.waitFor(() => expect(state.saves).toHaveLength(1));
    expect(state.saves[0]).toEqual({ keepUp: true, drops: true, dropPct: 15, floorPct: 60, freeAfterDays: null, handovers: ["porch", "meetup"], acceptsOffers: true });
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Listing defaults saved."));
    // Saved: what shows is now the saved row, and there is nothing left to save.
    await vi.waitFor(() => expect(button).toBeDisabled());
    expect(radio("How much each evening", "15%")).toHaveAttribute("aria-checked", "true");
  });

  it("a saved row shows as saved, including a lowest price share that is not one of the everyday choices", async () => {
    state.saved = { keepUp: false, drops: true, dropPct: 10, floorPct: 53, freeAfterDays: 14, handovers: ["meetup"], acceptsOffers: true };
    open();
    await save();
    expect(radio("How much each evening", "10%")).toHaveAttribute("aria-checked", "true");
    expect(radio("Lowest you'll take", "53%")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Safe meeting spot" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Porch pickup" })).not.toBeChecked();
    expect(screen.getByRole("switch", { name: "Keep it up until it sells" })).not.toBeChecked();
    expect(screen.getByRole("combobox", { name: /make it free after/i })).toHaveValue("14");
  });

  it("turning drops off hides its choices and is saved", async () => {
    open();
    const button = await save();
    fireEvent.click(screen.getByRole("switch", { name: /Lower the price/ }));
    expect(screen.queryByRole("radiogroup", { name: "How much each evening" })).toBeNull();
    fireEvent.click(button);
    await vi.waitFor(() => expect(state.saves[0]?.drops).toBe(false));
  });

  // LEAD-OFFERS-CHOICE (owner 2026-10-31): the default for a new listing.
  // @mutate src/components/declutter/DeclutterListingDefaults.tsx | onCheckedChange={(v) => change({ acceptsOffers: v === true })} | onCheckedChange={() => {}}
  // @mutate src/components/declutter/DeclutterListingDefaults.tsx |  a.keepUp === b.keepUp && a.acceptsOffers === b.acceptsOffers && |  a.keepUp === b.keepUp &&
  it("Accept offers is on with nothing saved; turning it off says Buy now only and is saved", async () => {
    open();
    const button = await save();
    const offers = screen.getByRole("switch", { name: /Accept offers/ });
    expect(offers).toHaveAttribute("aria-checked", "true");
    fireEvent.click(offers);
    expect(screen.getByText(/Buyers pay your price with Buy now; no offers\./)).toBeInTheDocument();
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await vi.waitFor(() => expect(state.saves[0]?.acceptsOffers).toBe(false));
  });

  it("with no way ticked Save is off and says why", async () => {
    open();
    const button = await save();
    fireEvent.click(screen.getByRole("checkbox", { name: "Porch pickup" }));
    expect(button).toBeDisabled();
    expect(screen.getByText("Tick at least one way buyers can get it.")).toBeInTheDocument();
  });

  it("pickup places have their own card, first on the page so a seller finds them", async () => {
    open();
    await screen.findByRole("button", { name: "Add a pickup place" });
    const card = screen.getByRole("region", { name: "Pickup places" });
    expect(card.previousElementSibling).toBeNull();
    expect(card.nextElementSibling).toBe(screen.getByRole("region", { name: "Listing defaults" }));
    expect(card.tagName).toBe("SECTION");
  });

  it("while the places read, their row holds the spot like its neighbours", async () => {
    state.places = new Promise(() => undefined) as unknown as unknown[];
    open();
    const card = await screen.findByRole("region", { name: "Pickup places" });
    expect(card.textContent).toBe("Pickup placesLoading…");
    expect(card.nextElementSibling).toBe(screen.getByRole("region", { name: "Listing defaults" }));
  });

  it("no card at all before the places are on the server", async () => {
    state.places = "not_deployed";
    open();
    await save();
    await screen.findByRole("group", { name: "Bundle discount" });
    expect(screen.queryByRole("region", { name: "Pickup places" })).toBeNull();
  });

  it("a stored Helpr delivery tick is dropped, and I'll deliver is not offered while its switch is off", async () => {
    state.saved = { keepUp: true, drops: true, dropPct: 5, floorPct: 50, freeAfterDays: null, handovers: ["delivery", "seller_delivery", "porch"], acceptsOffers: true };
    state.features.declutter_seller_delivery = false;
    open();
    const button = await save();
    expect(screen.queryByRole("checkbox", { name: "Helpr delivery" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "I'll deliver" })).toBeNull();
    // A hidden way alone is not a way a buyer can use: the note shows with porch unticked.
    fireEvent.click(screen.getByRole("checkbox", { name: "Porch pickup" }));
    expect(button).toBeDisabled();
    expect(screen.getByText("Tick at least one way buyers can get it.")).toBeInTheDocument();
  });

  it("a failed read shows the retry, never the defaults with a Save that would write over the real choices", async () => {
    state.readError = true;
    open();
    expect(await screen.findByText("We couldn't load your listing defaults.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("a save that did not happen says so and keeps the edit", async () => {
    state.saveResult = false;
    open();
    const button = await save();
    fireEvent.click(radio("How much each evening", "20%"));
    fireEvent.click(button);
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith("We couldn't save your listing defaults yet. Try again in a little while."));
    expect(toast).not.toHaveBeenCalled();
    expect(radio("How much each evening", "20%")).toHaveAttribute("aria-checked", "true");
    expect(button).toBeEnabled();
  });

  // NIGHT-SET-Declutterse-8: edits were lost without a word on leaving.
  it("an edit not saved says so, a closing tab asks first, and leaving says it wasn't saved", async () => {
    const view = open();
    await save();
    expect(screen.queryByText("Not saved yet. Tap Save to keep these.")).toBeNull();
    const untouched = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(untouched);
    expect(untouched.defaultPrevented).toBe(false);
    fireEvent.click(radio("How much each evening", "20%"));
    expect(screen.getByText("Not saved yet. Tap Save to keep these.")).toBeInTheDocument();
    const closing = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(closing);
    expect(closing.defaultPrevented).toBe(true);
    view.unmount();
    expect(toast).toHaveBeenCalledWith("Your changes to listing defaults weren't saved.");
  });

  it("saved, or never touched: leaving says nothing", async () => {
    const first = open();
    await save();
    first.unmount();
    expect(toast).not.toHaveBeenCalled();
    const view = open();
    const button = await save();
    fireEvent.click(radio("How much each evening", "20%"));
    // The edit shows the unsaved line first, so its absence below is reached, not the first paint.
    expect(await screen.findByText("Not saved yet. Tap Save to keep these.")).toBeInTheDocument();
    fireEvent.click(button);
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith("Listing defaults saved."));
    expect(screen.queryByText("Not saved yet. Tap Save to keep these.")).toBeNull();
    view.unmount();
    expect(toast).toHaveBeenCalledTimes(1);
  });
});
