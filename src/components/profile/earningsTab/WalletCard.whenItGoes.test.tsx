/**
 * A3-89 (lead 11-01): with instant payouts off the Wallet said "$40.00 ready to pay out" with no button and no date,
 * and a "LIVE" pill no member can read. Now the Available line says when the money reaches the bank: a payout Stripe
 * already has on its way gives its exact arrival day; otherwise the daily schedule (stripe-connect) sends it on its
 * own, usually within two business days. "ready to pay out" stays only beside the instant Cash out tile.
 *
 * @mutate src/components/profile/earningsTab/WalletCard.tsx |   if (instantTileShown) return "ready to pay out"; |   return "ready to pay out";
 * @mutate src/components/profile/earningsTab/WalletCard.tsx |   if (onWay) return | if (false) return
 * @mutate src/components/profile/earningsTab/WalletCard.tsx |     if (d.getDay() !== 0 && d.getDay() !== 6) left--; |     left--;
 * @mutate src/components/profile/earningsTab/WalletCard.tsx |   if (!stripeData.payouts_enabled) return "goes to your bank once payout setup is done"; |
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WalletCard, availableLine, twoBusinessDaysFrom } from "./WalletCard";
import type { StripePayoutData } from "./types";

const base: StripePayoutData = {
  connected: true, payouts_enabled: true, available: [{ amount: 4_000, currency: "usd" }], pending: [], instant_available: [], payouts: [],
};
const card = (data: StripePayoutData, instantOffered = false) => render(
  <WalletCard stripeData={data} refreshing={false} availableTotal={4_000} pendingTotal={11_300} canUseInstantPayout={false}
    instantOffered={instantOffered} onRefresh={() => {}} onCashOut={() => {}} onUpgrade={() => {}} />,
);

describe("WalletCard says when the money reaches the bank (A3-89)", () => {
  it("instant off, nothing on its way: 'goes to your bank on its own · usually by <2 business days>', no 'ready to pay out', no LIVE", () => {
    card(base);
    const line = screen.getByTestId("wallet-available-line").textContent!;
    expect(line).toMatch(/^goes to your bank on its own · usually by [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2}$/);
    expect(document.body.textContent).not.toMatch(/ready to pay out/);
    expect(document.body.textContent).not.toMatch(/LIVE/);
  });

  it("a payout Stripe has on its way: its exact arrival day", () => {
    const arrival = Date.UTC(2026, 10, 3, 18) / 1000; // Tue Nov 3 2026
    const line = availableLine({ ...base, payouts: [{ id: "po_1", amount: 4000, currency: "usd", status: "in_transit", arrival_date: arrival, method: "standard", created: arrival - 86400, description: null }] }, false);
    expect(line).toBe("on its way · reaches your bank Tue, Nov 3");
  });

  it("two business days skips the weekend: Friday -> Tuesday, Monday -> Wednesday", () => {
    expect(twoBusinessDaysFrom(new Date(2026, 10, 6)).getDate()).toBe(10); // Fri Nov 6 -> Tue Nov 10
    expect(twoBusinessDaysFrom(new Date(2026, 10, 9)).getDate()).toBe(11); // Mon Nov 9 -> Wed Nov 11
  });

  it("payouts not enabled: says setup comes first, never 'on its own'", () => {
    expect(availableLine({ ...base, payouts_enabled: false }, false)).toBe("goes to your bank once payout setup is done");
  });

  it("control: the instant tile drawn keeps 'ready to pay out' beside its Cash out", () => {
    card({ ...base, instant_available: [{ amount: 4_000, currency: "usd" }] }, true);
    expect(screen.getByTestId("wallet-available-line").textContent).toBe("ready to pay out");
    expect(screen.getByRole("button", { name: /cash out/i })).toBeTruthy();
  });
});
