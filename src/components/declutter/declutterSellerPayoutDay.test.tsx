/**
 * Audit 11-10 F394: the seller's handed-over card said only "Picked up." and dropped its money line, so the seller
 * had no idea when the money comes. Now the status says when it was handed over and the money line names the payout
 * day: 24 hours after the handover (checkWindowEnds), unless the buyer reports a problem before then.
 *
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |        ? sellerPaidWhen(sellerCents, handedOverAt, refunded \|\| problemOpen, payoutReady) |        ? null
 * F360b (lh-money-escrow review): no ready payout account, no day (the run puts the payout off); the day is a date only.
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |   if (!payoutReady) return | if (false) return
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |  const handedOverAt = done ? h.data?.confirmed_at ?? null : null; |  const handedOverAt = null;
 * @mutate src/components/declutter/DeclutterPorchHandover.tsx |  if (held \|\| !handedOverAt) return null; |  if (!handedOverAt) return null;
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { orderWhen, payoutDayAfterWindow } from "@/lib/declutter/timeLeft";

const HANDED = new Date(Date.now() - 3_600_000).toISOString();

// Owner 11-11 ~3:25 PM: declutter_my_setup_fee not deployed in these specs (PGRST202): the client's own fee reading.
vi.mock("@/lib/declutter/mySetupFee", () => ({ fetchMySetupFee: async () => null }));
vi.mock("./useOrderOtherPerson", () => ({ useOrderOtherPerson: () => ({ otherId: null, name: null, avatarUrl: null, first: null, who: "the buyer" }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/hooks/useFeature", () => ({ useFeature: () => false }));
vi.mock("@/lib/declutter/orderPickupTimes", async (orig) => ({ ...(await orig<typeof import("@/lib/declutter/orderPickupTimes")>()), fetchOrderPickupTimes: async () => [] }));
vi.mock("@/lib/declutter/handover", () => ({
  fetchMyHandover: async () => ({ set_out_at: null, picked_up_at: HANDED, confirmed_at: HANDED, status: "handed_over" }),
  handoverPhotoUrl: async () => null,
}));
const me = vi.hoisted(() => ({ profile: { stripe_account_id: "acct_x", stripe_payouts_enabled: true } as Record<string, unknown> }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me" }, profile: me.profile, isAdmin: false }) }));
vi.mock("./useMyPaidCents", () => ({ useMyPaidCents: () => new Map() }));

import { PickupStatus } from "./DeclutterPorchHandover";

/**
 * The money line's own words: "You get " + <strong>$30</strong> + ", paid on ...". A plain text matcher reads only a
 * node's own text ("You get , paid on ..."), so /You get \$/ never matched and a held payout's day went unseen.
 */
const youGetLine = (_: string, el: Element | null) => el?.tagName === "P" && /You get \$/.test(el.textContent ?? "");

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe("the seller's handed-over card says when it was handed over and when the money comes (F394)", () => {
  it("names the handover time and the payout day", async () => {
    wrap(<PickupStatus orderId="o1" handover="pickup_home" side="seller" slot={null} itemsCents={3000} />);
    const ends = payoutDayAfterWindow(new Date(new Date(HANDED).getTime() + 24 * 3_600_000).toISOString());
    expect(await screen.findByText((_, el) => el?.textContent === `You get $30, paid on ${ends} unless the buyer reports a problem before then.` && el.tagName === "P")).toBeInTheDocument();
    expect(screen.getByText(`Handed over ${orderWhen(HANDED)}.`)).toBeInTheDocument();
  });

  it("with no ready payout account it promises no day", async () => {
    me.profile = { stripe_account_id: null, stripe_payouts_enabled: false };
    wrap(<PickupStatus orderId="o1" handover="pickup_home" side="seller" slot={null} itemsCents={3000} />);
    expect(await screen.findByText((_, el) => el?.textContent === "You get $30 once you set up payouts in Settings." && el.tagName === "P")).toBeInTheDocument();
    me.profile = { stripe_account_id: "acct_x", stripe_payouts_enabled: true };
  });

  it("says nothing about the payout while a problem is open or after a refund", async () => {
    const { unmount } = wrap(<PickupStatus orderId="o1" handover="pickup_home" side="seller" slot={null} itemsCents={3000} problemOpen />);
    await screen.findByText(`Handed over ${orderWhen(HANDED)}.`); // the handover row is in: the money line has decided
    expect(screen.queryByText(youGetLine)).toBeNull();
    unmount();
    wrap(<PickupStatus orderId="o1" handover="pickup_home" side="seller" slot={null} itemsCents={3000} refunded />);
    await screen.findByText(/refund/i);
    expect(screen.queryByText(youGetLine)).toBeNull();
  });
});
