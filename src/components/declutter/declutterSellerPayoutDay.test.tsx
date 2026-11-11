/**
 * Audit 11-10 F394: the seller's handed-over card said only "Picked up." and dropped its money line, so the seller
 * had no idea when the money comes. Now the status says when it was handed over and the money line names the payout
 * day: 24 hours after the handover (checkWindowEnds), unless the buyer reports a problem before then.
 *
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |        ? sellerPaidWhen(sellerCents, handedOverAt, refunded \|\| problemOpen) |        ? null
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |  const handedOverAt = done ? h.data?.confirmed_at ?? null : null; |  const handedOverAt = null;
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |  if (held \|\| !handedOverAt) return null; |  if (!handedOverAt) return null;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { orderWhen } from "@/lib/declutter/timeLeft";

const HANDED = new Date(Date.now() - 3_600_000).toISOString();

vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: null, name: null, avatarUrl: null, first: null, who: "the buyer" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/orderPickupTimes", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/orderPickupTimes")>()), fetchOrderPickupTimes: async () => [] }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async () => ({ set_out_at: null, picked_up_at: HANDED, confirmed_at: HANDED, status: "handed_over" }),
  handoverPhotoUrl: async () => null,
}));
vi.mock("./useMyPaidCents", () => ({ useMyPaidCents: () => new Map() }));

import { PickupStatus } from "./DeclutterPorchHandover";

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe("the seller's handed-over card says when it was handed over and when the money comes (F394)", () => {
  it("names the handover time and the payout day", async () => {
    wrap(<PickupStatus orderId="o1" handover="pickup_home" side="seller" slot={null} itemsCents={3000} />);
    const ends = orderWhen(new Date(new Date(HANDED).getTime() + 24 * 3_600_000).toISOString());
    const note = await screen.findByText(/You get/);
    expect(note.textContent).toBe(`You get $30 on ${ends} unless the buyer reports a problem before then.`);
    expect(screen.getByText(`Handed over ${orderWhen(HANDED)}.`)).toBeInTheDocument();
  });

  it("says nothing about the payout while a problem is open or after a refund", async () => {
    const { unmount } = wrap(<PickupStatus orderId="o1" handover="pickup_home" side="seller" slot={null} itemsCents={3000} problemOpen />);
    await screen.findByText(/Handed over/);
    expect(screen.queryByText(/You get \$/)).toBeNull();
    unmount();
    wrap(<PickupStatus orderId="o1" handover="pickup_home" side="seller" slot={null} itemsCents={3000} refunded />);
    await screen.findByText(/refund/i);
    expect(screen.queryByText(/You get \$/)).toBeNull();
  });
});
