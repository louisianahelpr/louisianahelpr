/**
 * Audit DD D1 (lead 2026-10-30, shots dd-d1-deliver-tab-p1..p3-375wk): the Deliver tab stacked five cards with the
 * deliveries to take last, and offered "Go online" before the Helpr had a vehicle. Now:
 *   - no car saved: the full explainer, then "Your vehicle" as step 1, then the deliveries list; no Go online;
 *   - a car saved: the deliveries to take first, then the Helpr's own, then Go online, and "Your vehicle" last;
 *     the explainer folds to its title, which opens it again;
 *   - saving the first car never moves the vehicle card (its place is decided by the first read).
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       {setUp && <GoOnlineCard userId={userId} where={where} />} |       <GoOnlineCard userId={userId} where={where} />
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       {setUp ? <DeliverExplainer collapsed /> : intro} |       {intro}
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       {vehicleFirst === true && <VehicleForm userId={userId} />} |
 * Audit 1c D3-6: a Helpr with no car is told how many deliveries are open (helpr_tasks_open_count, every vehicle),
 * and the busy card counts every open delivery, not only those the Helpr's vehicle fits.
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const waiting = (counts.data ?? []).reduce((n, r) => n + r.open_count, 0); |   const waiting = 0;
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   const busyRows = counts.data ?? openList; |   const busyRows = openList;
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |   if (vehicleFirst === null && vehicle.isSuccess) setVehicleFirst(!vehicle.data?.has_car); |   if (vehicle.isSuccess && vehicleFirst !== !vehicle.data?.has_car) setVehicleFirst(!vehicle.data?.has_car);
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  vehicle: null as null | { has_car: boolean; has_truck: boolean; second_person: boolean; photo_path: string | null },
  open: [] as unknown[],
  counts: null as null | { pickup_area: string; open_count: number }[],
  busy: [] as unknown[],
}));

vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: undefined }) }));
vi.mock("@/components/payouts/useHiredPayoutPrompt", () => ({ useHiredPayoutPrompt: () => ({ open: false, offer: async () => true, close: () => {} }) }));
vi.mock("@/components/busyAreas/BusyAreasCard", () => ({
  BusyAreasCard: ({ deliveries }: { deliveries: unknown[] }) => {
    state.busy = deliveries;
    return <section aria-label="Busy right now" />;
  },
}));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.5, lng: -91.15 }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false, usePayoutSetupBlock: () => null }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchTaskView: async () => null,
  fetchOpenTasks: async () => state.open,
  fetchMyTasks: async () => [],
  fetchMyRoute: async () => ({ stops: [], miles: 0, drive_minutes: 0, finish_at: null }),
  fetchRouteSuggestions: async () => ({ suggestions: [], reason: "none_near" }),
  fetchMyVehicle: async () => state.vehicle,
  fetchOpenCount: async () => state.counts,
  fetchTaskPickupWindows: async () => ({ windows: [], latestPickupAt: null }),
  taskPhotoUrl: async (p: string) => `https://signed.test/${p}`,
  acceptTask: vi.fn(), releaseTask: vi.fn(), markPickedUp: vi.fn(), markDelivered: vi.fn(), reportPickupNoShow: vi.fn(), confirmReceived: vi.fn(),
  saveVehicle: async (hasCar: boolean, hasTruck: boolean, second: boolean, photo: string | null) => {
    state.vehicle = { has_car: hasCar, has_truck: hasTruck, second_person: second, photo_path: photo };
  },
  uploadTaskPhoto: vi.fn(), uploadVehiclePhoto: vi.fn(),
}));
vi.mock("@/lib/helprTasks/online", () => ({ fetchOnlineStatus: async () => null, isOnline: () => false, setOnline: vi.fn() }));
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));
vi.mock("@/lib/declutter/deliveryTip", () => ({ fetchMyPaidDeliveryTips: async () => [], fetchTipsOnMyDeliveries: async () => new Map(), startDeliveryTip: vi.fn() }));
vi.mock("./useDeclutterOrigin", () => ({ useDeclutterOrigin: () => ({ origin: { status: "none", zipOnFile: false } }) }));

import { DeliverView } from "./DeclutterDeliveryViews";

const OPEN = {
  task_id: "t1", size: "small", title: "Blue mug", pickup_area: "Downtown", dropoff_area: "Baker", trip_miles: 4,
  miles_to_pickup: 2, take_home_cents: 1600, latest_pickup_at: "2099-11-06T15:00:00Z", open_until: "2099-11-01T15:00:00Z",
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeliverView /></QueryClientProvider>);
}

/** The page's cards, top to bottom, by their names. */
function order(container: HTMLElement): string[] {
  const page = container.firstElementChild as HTMLElement;
  return [...page.children]
    .filter((el) => el.tagName === "SECTION")
    .map((el) => el.getAttribute("aria-label") ?? document.getElementById(el.getAttribute("aria-labelledby") ?? "")?.textContent?.trim() ?? "");
}

const PAY = /A 5-mile trip pays you/;

beforeEach(() => {
  state.vehicle = null;
  state.open = [];
  state.counts = null;
  state.busy = [];
});

describe("Deliver puts the next step first (audit DD D1)", () => {
  it("no car: the explainer, then Your vehicle as step 1, then the deliveries; no Go online", async () => {
    const { container } = show();
    await screen.findByRole("checkbox", { name: "I have a car" });
    await screen.findByText("Add your car under Your vehicle to take deliveries.");
    expect(order(container)).toEqual(["Deliver Declutter items and get paid", "Your vehicle", "Deliveries near you", "Your deliveries"]);
    expect(screen.queryByRole("switch", { name: "Online for deliveries" })).toBeNull();
    expect(screen.getByText(PAY)).toBeInTheDocument();
  });

  it("a car saved: deliveries first, then Go online, Your vehicle last; the explainer folds and opens again", async () => {
    state.vehicle = { has_car: true, has_truck: false, second_person: false, photo_path: null };
    state.open = [OPEN];
    const { container } = show();
    await screen.findByText("Blue mug");
    await screen.findByRole("switch", { name: "Online for deliveries" });
    expect(order(container)).toEqual([
      "Deliver Declutter items and get paid", "Deliveries near you", "Your deliveries", "Go online for deliveries", "Busy right now", "Your vehicle",
    ]);
    expect(screen.queryByText(PAY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Deliver Declutter items and get paid" }));
    expect(await screen.findByText(PAY)).toBeInTheDocument();
  });

  it("saving the first car keeps Your vehicle where it is and its Vehicle saved line shows", async () => {
    const { container } = show();
    fireEvent.click(await screen.findByRole("checkbox", { name: "I have a car" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Vehicle saved.")).toBeInTheDocument();
    await screen.findByRole("switch", { name: "Online for deliveries" });
    await waitFor(() => expect(order(container).slice(0, 2)).toEqual(["Deliver Declutter items and get paid", "Your vehicle"]));
    expect(screen.getByText("Vehicle saved.")).toBeInTheDocument();
  });

  it("no car: how many deliveries are open, by every vehicle, and the busy card counts them (audit 1c D3-6)", async () => {
    state.counts = [{ pickup_area: "Downtown, Baton Rouge", open_count: 2 }, { pickup_area: "Broussard, LA", open_count: 1 }];
    show();
    expect(await screen.findByText("3 deliveries are waiting.")).toBeInTheDocument();
    expect(screen.getByText("Add your car under Your vehicle to take deliveries.")).toBeInTheDocument();
    await waitFor(() => expect(state.busy).toEqual(state.counts));
  });

  it("before the count read is deployed: no count line, and the busy card counts the listed deliveries", async () => {
    state.vehicle = { has_car: true, has_truck: false, second_person: false, photo_path: null };
    state.open = [OPEN];
    show();
    await screen.findByText("Blue mug");
    expect(screen.queryByText(/deliver(y is|ies are) waiting/)).toBeNull();
    await waitFor(() => expect(state.busy).toEqual([OPEN]));
  });
});
