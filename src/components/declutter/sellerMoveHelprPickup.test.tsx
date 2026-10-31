/**
 * BUY-42 (buying audit 10-30 #42): the seller could not move a booked Helpr's pickup time; they were only told. The
 * seller's delivery card (SellerHandedOver, shown while a Helpr is booked and nothing is held) now offers "Move pickup
 * time": the seller's own pickup chips, then "Move to this time" calls helpr_task_seller_move_pickup
 * (20261031095846; PGlite: src/test/pglite/helprTaskSellerMovePickup.pglite.mjs). Once handed over, no move.
 *
 * @mutate src/components/declutter/SellerHandedOver.tsx |       <SellerMoveHelprPickup taskId={taskId} orderId={orderId} who={who} current={pickupAt} />\n |
 * AUD31-83: the seller reads "Your pickup times" (own) and the booked time is marked among the chips (current).
 * @mutate src/components/declutter/SellerMoveHelprPickup.tsx | onPick={setPick} own current={current} | onPick={setPick} current={current}
 * @mutate src/components/declutter/SellerHandedOver.tsx | who={who} current={pickupAt} /> | who={who} />
 * @mutate src/components/declutter/SellerMoveHelprPickup.tsx |           onClick={() => { if (pick) move.mutate(pick); }}> |           onClick={() => setOpen(false)}>
 * @mutate src/lib/helprTasks/api.ts |     await supabase.rpc("helpr_task_seller_move_pickup", { p_task_id: taskId, p_pickup_slot_start: pickupSlotStartIso }), |     await supabase.rpc("helpr_task_seller_move_pickup", { p_task_id: taskId, p_pickup_slot_start: taskId }),
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({ calls: [] as Array<[string, unknown]> }));
const NEW_TIME = "2026-11-02T15:00:00.000Z";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async (name: string, args: unknown) => { state.calls.push([name, args]); return { data: { result: "moved", pickup_slot_start: NEW_TIME }, error: null }; } },
}));
vi.mock("./DeclutterPickupWindows", () => ({
  PickupSlotPicker: ({ onPick, orderId, own, current }: { onPick: (iso: string | null) => void; orderId?: string; own?: boolean; current?: string | null }) => (
    <><button type="button" onClick={() => onPick(NEW_TIME)}>{`chip for ${orderId}`}</button><span data-testid="picker-props">{`own=${String(own)} current=${String(current)}`}</span></>
  ),
}));

import { SellerHandedOver } from "./SellerHandedOver";

function show(handedOverAt: string | null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><SellerHandedOver taskId="t1" orderId="o1" who="Sam" handedOverAt={handedOverAt} pickupAt="2026-11-01T18:00:00.000Z" /></QueryClientProvider>);
}

describe("BUY-42: the seller moves a booked Helpr's pickup once", () => {
  beforeEach(() => { state.calls = []; });

  it("Move pickup time -> the seller's own chips for this order -> Move to this time calls the move RPC", async () => {
    show(null);
    fireEvent.click(screen.getByRole("button", { name: "Move pickup time" }));
    expect(screen.getByText(/You can move it once; Sam and the buyer are told/)).toBeInTheDocument();
    // AUD31-83: the seller's own times, with the time booked now marked.
    expect(screen.getByTestId("picker-props").textContent).toBe("own=true current=2026-11-01T18:00:00.000Z");
    const go = screen.getByRole("button", { name: "Move to this time" });
    expect(go).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "chip for o1" }));
    fireEvent.click(screen.getByRole("button", { name: "Move to this time" }));
    await waitFor(() => expect(state.calls).toEqual([["helpr_task_seller_move_pickup", { p_task_id: "t1", p_pickup_slot_start: NEW_TIME }]]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Move pickup time" })).toBeInTheDocument());
  });

  it("Keep the time closes it without a call", () => {
    show(null);
    fireEvent.click(screen.getByRole("button", { name: "Move pickup time" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep the time" }));
    expect(screen.getByRole("button", { name: "Move pickup time" })).toBeInTheDocument();
    expect(state.calls).toEqual([]);
  });

  it("once handed over, there is no move", () => {
    show("2026-11-01T15:00:00.000Z");
    expect(screen.queryByRole("button", { name: "Move pickup time" })).toBeNull();
    expect(screen.getByText(/You said you handed it over/)).toBeInTheDocument();
  });
});
