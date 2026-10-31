/**
 * BUY-40 (buying audit 10-30): on a Helpr delivery's pickup stop, "Picked up" fired the moment a photo was chosen:
 * no preview, no retake, no button, though the drop-off step has all three. And the photo uploaded before the
 * location was read, so a refusal for being far away still left an upload. Now the photo is picked (shown, can be
 * retaken), "Picked up" sends it, the location is read first, and a retry reuses the same upload.
 *
 * @mutate src/components/declutter/StopActions.tsx | disabled={pickedUp.isPending \|\| (opensAt !== null && stop.handed_over_at === null)} onPick={setPickPhoto} /> | disabled={pickedUp.isPending \|\| (opensAt !== null && stop.handed_over_at === null)} onPick={(f) => pickedUp.mutate(f)} />
 * @mutate src/components/declutter/useTaskSteps.ts |      const where = await currentPosition();\n      if (pickedUpPhoto.current?.file !== file) |      if (pickedUpPhoto.current?.file !== file)
 * @mutate src/components/declutter/useTaskSteps.ts |      if (pickedUpPhoto.current?.file !== file) pickedUpPhoto.current = | pickedUpPhoto.current =
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouteStop } from "@/lib/helprTasks/api";

const state = vi.hoisted(() => ({ order: [] as string[], refuse: false }));

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/declutter/position", () => ({ currentPosition: async () => { state.order.push("where"); return { lat: 30.5, lng: -91.15 }; } }));
vi.mock("@/lib/helprTasks/api", () => ({
  markPickedUp: async (taskId: string, path: string) => {
    state.order.push(`picked:${taskId}:${path}`);
    if (state.refuse) throw new Error("too_far");
  },
  markDelivered: vi.fn(),
  reportPickupNoShow: vi.fn(),
  uploadTaskPhoto: async (_u: string, taskId: string, f: File) => { state.order.push(`upload:${f.name}`); return `u1/${taskId}/${f.name}`; },
}));

import { StopActions } from "./StopActions";

const STOP = {
  seq: 1, task_id: "t1", kind: "pickup", status: "accepted", title: "Blue mug", size: "small", area: "Downtown",
  address: "900 North 3rd Street", lat: 30.45, lng: -91.18, place: "door", items: [],
  slot_start: new Date(Date.now() - 5 * 60_000).toISOString(), slot_end: new Date(Date.now() + 25 * 60_000).toISOString(),
  arrive_at: null, late: false, leg_miles: 1, address_shows_at: null, handed_over_at: null,
} as unknown as RouteStop;

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><StopActions stop={STOP} userId="u1" /></QueryClientProvider>);
}

const pick = (name: string) => {
  const input = screen.getByLabelText(/Picked up: a photo of the item, taken here/) as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: "image/jpeg" })] } });
};

beforeEach(() => { state.order = []; state.refuse = false; });

describe("BUY-40: a delivery's Picked up photo is picked first, then sent", () => {
  it("choosing a photo sends nothing; Picked up sends it, location first", async () => {
    show();
    expect(screen.queryByRole("button", { name: "Picked up" })).toBeNull();
    pick("mug.jpg");
    await new Promise((r) => setTimeout(r, 20));
    expect(state.order).toEqual([]);
    fireEvent.click(await screen.findByRole("button", { name: "Picked up" }));
    await waitFor(() => expect(state.order).toEqual(["where", "upload:mug.jpg", "picked:t1:u1/t1/mug.jpg"]));
  });

  it("a refused Picked up keeps the photo; the retry reuses the same upload", async () => {
    state.refuse = true;
    show();
    pick("mug.jpg");
    fireEvent.click(await screen.findByRole("button", { name: "Picked up" }));
    await waitFor(() => expect(state.order).toContain("picked:t1:u1/t1/mug.jpg"));
    state.order = [];
    state.refuse = false;
    fireEvent.click(await screen.findByRole("button", { name: "Picked up" }));
    await waitFor(() => expect(state.order).toEqual(["where", "picked:t1:u1/t1/mug.jpg"]));
  });
});
