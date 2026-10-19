/**
 * Homes bank rent card (D2/D7/D9; DRAFT, TEST mode only). The server side is proven by
 * src/test/pglite/homesBankRent.pglite.mjs; this pins what each side sees and what each control sends.
 *
 * @mutate src/components/rentals/RentBankPanel.tsx |   const fee = s.fee_payer === "tenant" ? bankFeeCents(cents, "tenant") : 0; |   const fee = 0;
 * @mutate src/components/rentals/RentBankPanel.tsx |   if (!s.bank_pay) return null; |   if (false) return null;
 * @mutate src/components/rentals/RentBankPanel.tsx |                 onClick={() => toggle.mutate({ on: !s.bank_pay, payer: s.fee_payer })}> |                 onClick={() => toggle.mutate({ on: true, payer: s.fee_payer })}>
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BankState } from "@/lib/rentals/rentBank";

const state: { s: BankState } = { s: undefined as unknown as BankState };
const setBankPay = vi.fn(async (..._a: unknown[]) => undefined);
const payRentByBank = vi.fn(async (..._a: unknown[]) => undefined);
const setAutopay = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("@/lib/rentals/rentBank", async (orig) => ({
  ...(await orig<typeof import("@/lib/rentals/rentBank")>()),
  fetchBankState: async () => state.s,
  setBankPay: (...a: unknown[]) => setBankPay(...a),
  payRentByBank: (...a: unknown[]) => payRentByBank(...a),
  setAutopay: (...a: unknown[]) => setAutopay(...a),
}));
import { RentBankPanel } from "./RentBankPanel";

const S = (o: Partial<BankState> = {}): BankState => ({ bank_pay: true, fee_payer: "tenant", payouts_ready: null, autopay: { enabled: false }, in_flight: null, ...o });
const renderPanel = (side: "tenant" | "landlord", balance = 120000) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RentBankPanel tenancyId="t1" side={side} balanceCents={balance} />
    </QueryClientProvider>,
  );

describe("RentBankPanel (bank rent draft)", () => {
  beforeEach(() => {
    for (const f of [setBankPay, payRentByBank, setAutopay]) f.mockClear();
  });

  it("tenant: the bank cost is shown before paying, then Pay by bank sends the rent amount", async () => {
    state.s = S();
    renderPanel("tenant");
    expect((await screen.findByTestId("bank-fee-line")).textContent).toBe("Bank cost $5.00 (0.8%, at most $5). Your bank is charged $1,205.00.");
    fireEvent.click(screen.getByRole("button", { name: "Pay by bank" }));
    await waitFor(() => expect(payRentByBank).toHaveBeenCalledWith("t1", 120000));
  });

  it("tenant: off means no bank card; a payment in flight says it counts once the bank confirms", async () => {
    state.s = S({ bank_pay: false });
    const { unmount } = renderPanel("tenant");
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("button", { name: "Pay by bank" })).toBeNull();
    unmount();
    state.s = S({ in_flight: { status: "processing", rent_cents: 120000, charge_cents: 120500, started_at: "2026-10-19T10:00:00Z" } });
    renderPanel("tenant");
    expect((await screen.findByTestId("bank-in-flight")).textContent).toContain("counts once your bank confirms it");
  });

  it("landlord: turns it off, and switches who pays the bank cost", async () => {
    state.s = S({ payouts_ready: true });
    renderPanel("landlord");
    fireEvent.click(await screen.findByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(setBankPay).toHaveBeenCalledWith("t1", false, "tenant"));
    fireEvent.click(screen.getByRole("button", { name: "I'll pay the bank cost" }));
    await waitFor(() => expect(setBankPay).toHaveBeenLastCalledWith("t1", true, "landlord"));
  });
});
