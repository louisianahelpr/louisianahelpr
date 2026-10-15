// Roadmap F4a (owner 2026-10-15): while memberships are off, instant cash-out
// is off for EVERYONE and nothing offers an upgrade. Cash Out is the standard
// payout only: the wallet shows no instant tile, no plan chip, no upgrade tap.
// The instant-payout edge function refuses on the same switch
// (src/test/edge/instant-payout-fee-alerts.test.ts, F4a describe).
//
// @mutate src/components/profile/earningsTab/WalletCard.tsx | if (!instantOffered \|\| instantAvailable <= 0) return null; | if (instantAvailable <= 0) return null;
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletCard } from "./WalletCard";
import type { StripePayoutData } from "./types";

const stripeData: StripePayoutData = {
  connected: true,
  payouts_enabled: true,
  available: [{ amount: 12_000, currency: "usd" }],
  pending: [],
  instant_available: [{ amount: 12_000, currency: "usd" }],
  payouts: [],
};

function renderCard(instantOffered: boolean, canUseInstantPayout: boolean) {
  const onUpgrade = vi.fn();
  const onCashOut = vi.fn();
  render(
    <WalletCard
      stripeData={stripeData}
      refreshing={false}
      availableTotal={12_000}
      pendingTotal={0}
      canUseInstantPayout={canUseInstantPayout}
      instantOffered={instantOffered}
      onRefresh={() => {}}
      onCashOut={onCashOut}
      onUpgrade={onUpgrade}
    />,
  );
  return { onUpgrade, onCashOut };
}

describe("WalletCard: no instant cash-out and no upgrade while memberships are off (F4a)", () => {
  it("memberships off: no instant tile, no Cash Out button, no subscribe copy", () => {
    renderCard(false, false);
    expect(screen.queryByText(/instant cash out/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /cash out/i })).toBeNull();
    expect(screen.queryByText(/subscribe/i)).toBeNull();
  });

  it("memberships off hides the tile even for a plan holder", () => {
    renderCard(false, true);
    expect(screen.queryByText(/instant cash out/i)).toBeNull();
  });

  it("control: memberships on, the same balance renders the instant tile", () => {
    renderCard(true, true);
    expect(screen.getByText(/instant cash out/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /cash out/i })).toBeTruthy();
  });
});
