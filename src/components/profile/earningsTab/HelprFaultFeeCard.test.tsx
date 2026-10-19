import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { HelprFaultFeeCard, helprFaultFeeTotals } from "./HelprFaultFeeCard";

/**
 * lh-money-escrow re-review of b1730c932 #7: the Helpr-fault bill notice links
 * to the earnings tab, which never showed what was owed or already taken. The
 * tab now says both plainly.
 * @mutate src/components/profile/earningsTab/HelprFaultFeeCard.tsx |     takenCents += billed - left; |     takenCents += 0;
 * @mutate src/components/profile/earningsTab/HelprFaultFeeCard.tsx |  if (owedCents <= 0 && takenCents <= 0) return null; |  if (owedCents >= 0) return null;
 * @mutate src/components/profile/EarningsTab.tsx |      {pageReady && <HelprFaultFeeCard userId={profile?.user_id} />} |
 */
const result: { data: unknown; error: unknown } = { data: [], error: null };
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: async () => result }) }) },
}));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HelprFaultFeeCard userId="helper-1" />
    </QueryClientProvider>,
  );

describe("the earnings tab shows Helpr-fault card fees owed and taken", () => {
  beforeEach(() => {
    result.data = [];
    result.error = null;
  });
  it("adds owed and already-taken cents across rulings", () => {
    expect(helprFaultFeeTotals([
      { card_fee_cents: 369, card_fee_remaining_cents: 69 },
      { card_fee_cents: 120, card_fee_remaining_cents: 120 },
      { card_fee_cents: 0, card_fee_remaining_cents: 0 },
    ])).toEqual({ owedCents: 189, takenCents: 300 });
  });
  it("says what is still owed and what was already taken, in exact cents", async () => {
    result.data = [{ card_fee_cents: 369, card_fee_remaining_cents: 69 }];
    mount();
    expect(await screen.findByText("$0.69 still owed. It comes out of your next payout.")).toBeTruthy();
    expect(screen.getByText("$3.00 already taken from your payouts.")).toBeTruthy();
  });
  it("shows nothing when no card fee was ever billed", async () => {
    result.data = [];
    const { container } = mount();
    await waitFor(() => expect(container.innerHTML).toBe(""));
  });
  it("a failed read says so instead of showing nothing", async () => {
    result.error = { message: "boom" };
    mount();
    expect(await screen.findByText(/Couldn't load the card fees you owe/)).toBeTruthy();
  });
  it("is mounted on the earnings tab (inventory floor)", () => {
    const tab = readFileSync("src/components/profile/EarningsTab.tsx", "utf8");
    const mounts = tab.split("<HelprFaultFeeCard").length - 1;
    expect(mounts).toBeGreaterThan(0);
  });
});
