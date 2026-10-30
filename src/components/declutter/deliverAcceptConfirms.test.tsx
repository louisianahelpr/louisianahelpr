/**
 * Audit 1c D3-8 (Declutter Helpr delivery on prod, 2026-10-29, 1c-h2-after-accept-375): after "Accept delivery" the
 * page asked helpr_task_pickup_windows again for the task it had just taken (500 task_not_found), and neither the
 * accept nor the vehicle Save showed any confirmation: a plain toast.success renders nothing app-wide
 * (src/lib/toastPolicy.ts; docs/audit/toast-inventory.json "renders": false).
 *   - after the accept, no pickup-times read goes out for that task;
 *   - the accept confirms with a toast that renders (it carries an action, which toastPolicy lets through);
 *   - Save says "Vehicle saved." on the form, and the line goes once the Helpr changes a box.
 *
 * @mutate src/components/declutter/DeclutterDeliveryViews.tsx |       qc.removeQueries({ queryKey: ["helpr-tasks", "task-pickup-windows", t.task_id] }); |
 * @mutate src/components/declutter/DeclutterPickupWindows.tsx | queryFn: () => fetchTaskPickupWindows(taskId), enabled } | queryFn: () => fetchTaskPickupWindows(taskId) }
 * @mutate src/components/declutter/DeliverVehicleForm.tsx |       {save.isSuccess && <p className="text-sm font-medium" role="status">Vehicle saved.</p>} |
 * @mutate src/components/declutter/DeliverVehicleForm.tsx | onCheckedChange={(v) => { save.reset(); setCar(v === true); }} /> | onCheckedChange={(v) => { setCar(v === true); }} />
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  open: [] as unknown[],
  mine: [] as unknown[],
  windowReads: [] as string[],
  calls: [] as unknown[][],
  toasts: [] as { msg: string; opts?: { action?: { label: string } } }[],
}));

vi.mock("@/components/DateTimeField", () => ({
  DateTimeField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
vi.mock("sonner", () => ({
  toast: { success: (msg: string, opts?: { action?: { label: string } }) => { state.toasts.push({ msg, opts }); }, error: vi.fn() },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: undefined }) }));
vi.mock("@/components/payouts/useHiredPayoutPrompt", () => ({ useHiredPayoutPrompt: () => ({ open: false, offer: async () => true, close: () => {} }) }));
vi.mock("@/components/busyAreas/BusyAreasCard", () => ({ BusyAreasCard: () => null }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => ({ lat: 30.5, lng: -91.15 }) }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false, usePayoutSetupBlock: () => null }));
vi.mock("@/lib/helprTasks/api", () => ({
  fetchTaskView: async () => null,
  fetchOpenTasks: async () => state.open,
  fetchMyTasks: async () => state.mine,
  fetchMyRoute: async () => ({ stops: [], miles: 0, drive_minutes: 0, finish_at: null }),
  fetchRouteSuggestions: async () => ({ suggestions: [], reason: "none_near" }),
  fetchMyVehicle: async () => ({ has_car: true, has_truck: false, second_person: false, photo_path: null }),
  fetchOpenCount: async () => null,
  fetchTaskPickupWindows: async (taskId: string) => {
    state.windowReads.push(taskId);
    return { windows: [{ weekday: 6, starts: "09:00", ends: "12:00" }], latestPickupAt: null };
  },
  taskPhotoUrl: async (p: string) => `https://signed.test/${p}`,
  acceptTask: async (...a: unknown[]) => {
    state.calls.push(["accept", ...a]);
    // The server took it: it leaves the open list.
    state.open = [];
  },
  releaseTask: vi.fn(), markPickedUp: vi.fn(), markDelivered: vi.fn(), reportPickupNoShow: vi.fn(), confirmReceived: vi.fn(),
  saveVehicle: async (...a: unknown[]) => { state.calls.push(["vehicle", ...a]); },
  uploadTaskPhoto: vi.fn(), uploadVehiclePhoto: vi.fn(),
}));
vi.mock("@/lib/helprTasks/online", () => ({ fetchOnlineStatus: async () => null, isOnline: () => false, setOnline: vi.fn() }));
vi.mock("@/lib/declutter/deliveryRaise", () => ({ fetchDeliveryRaiseStatus: async () => null, startDeliveryRaise: vi.fn() }));
vi.mock("@/lib/declutter/deliveryTip", () => ({ fetchMyPaidDeliveryTips: async () => [], fetchTipsOnMyDeliveries: async () => new Map(), startDeliveryTip: vi.fn() }));

import { DeliverView } from "./DeclutterDeliveryViews";

const OPEN = {
  task_id: "t1", size: "small", title: "Blue mug", pickup_area: "Downtown", dropoff_area: "Baker", trip_miles: 4,
  miles_to_pickup: 2, take_home_cents: 1600, latest_pickup_at: "2099-11-06T15:00:00Z", open_until: "2099-11-01T15:00:00Z",
};

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeliverView /></QueryClientProvider>);
}

beforeEach(() => {
  state.open = [OPEN];
  state.mine = [];
  state.windowReads = [];
  state.calls = [];
  state.toasts = [];
});

describe("Deliver: accepting confirms, and asks nothing more of the taken task (audit 1c D3-8)", () => {
  it("after Accept delivery no pickup-times read goes out for that task, and a toast that renders confirms it", async () => {
    show();
    await screen.findByText("Blue mug");
    const group = await screen.findByRole("group", { name: /^Pickup time on / });
    fireEvent.click(group.querySelector("button") as HTMLButtonElement);
    const reads = state.windowReads.length;
    expect(reads).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Accept delivery" }));
    await waitFor(() => expect(state.calls[0]?.[0]).toBe("accept"));
    // The list re-read after the accept says so (wait for that, then the absence: waitForEmptyIsVacuous).
    expect(await screen.findByText(/^No deliveries to take right now\./)).toBeInTheDocument();
    expect(screen.queryByText("Blue mug")).toBeNull();
    expect(state.windowReads.length, "no read of the taken task's pickup times after the accept").toBe(reads);
    const done = state.toasts.find((t) => t.msg.startsWith("Delivery accepted"));
    expect(done?.opts?.action?.label, "the confirmation carries an action, so toastPolicy lets it render").toBe("See it");
  });

  it("Save says Vehicle saved on the form; changing a box clears it", async () => {
    show();
    const save = await screen.findByRole("button", { name: "Save" });
    fireEvent.click(save);
    expect(await screen.findByText("Vehicle saved.")).toBeInTheDocument();
    expect(state.calls.some((c) => c[0] === "vehicle")).toBe(true);
    const car = screen.getByRole("checkbox", { name: "I have a car" });
    fireEvent.click(car);
    // The click is the precondition (the box really changed), then the absence (waitForEmptyIsVacuous).
    expect(car).not.toBeChecked();
    expect(screen.queryByText("Vehicle saved.")).toBeNull();
  });

  // D3-9 said the vehicle checkboxes had no accessible name. Each is named by its <label htmlFor> (measured here, the
  // accessible-name rules testing-library applies); this pins it.
  it("each vehicle checkbox has its accessible name", async () => {
    show();
    await screen.findByRole("button", { name: "Save" });
    let n = 0;
    for (const name of ["I have a car", "I have a truck"]) {
      expect(screen.getByRole("checkbox", { name })).toBeInTheDocument();
      n++;
    }
    expect(n).toBe(2);
  });
});
