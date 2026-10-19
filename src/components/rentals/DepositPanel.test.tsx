/**
 * Homes security deposit, track only (D6, R.S. 9:3251). The server side (who may act, the address rule,
 * returned + kept = the deposit, final, reminders) is proven by src/test/pglite/homesDepositTracker.pglite.mjs;
 * this pins the screen: what each side sees and that each control sends the right call.
 *
 * @mutate src/components/rentals/DepositPanel.tsx |       return setDeposit(tenancyId, cents, on); |       return setDeposit(tenancyId, 0, on);
 * @mutate src/components/rentals/DepositPanel.tsx |         returned, |         amountCents,
 * @mutate src/components/rentals/DepositPanel.tsx |   const valid = returned >= 0 && rows.every((r, i) => r.reason.trim().length >= 3 && (kept[i] ?? 0) > 0); |   const valid = true;
 * @mutate src/components/rentals/DepositPanel.tsx |         side === "landlord" && status === "active" ? ( |         status === "active" ? (
 * @mutate src/components/rentals/DepositPanel.tsx |           ) : status === "ended" ? ( |           ) : true ? (
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DepositRecord } from "@/lib/rentals/rent";

const state: { rec: DepositRecord | Error } = { rec: undefined as unknown as DepositRecord };
const setDeposit = vi.fn(async (..._a: unknown[]) => undefined);
const setForwardingAddress = vi.fn(async (..._a: unknown[]) => undefined);
const settleDeposit = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("@/lib/rentals/rent", async (orig) => ({
  ...(await orig<typeof import("@/lib/rentals/rent")>()),
  fetchDeposit: async () => {
    if (state.rec instanceof Error) throw state.rec;
    return state.rec;
  },
  setDeposit: (...a: unknown[]) => setDeposit(...a),
  setForwardingAddress: (...a: unknown[]) => setForwardingAddress(...a),
  settleDeposit: (...a: unknown[]) => settleDeposit(...a),
}));

import { DepositPanel } from "./DepositPanel";

const D = (o: Partial<NonNullable<DepositRecord["deposit"]>> = {}): NonNullable<DepositRecord["deposit"]> => ({
  amount_cents: 120000,
  received_on: "2026-10-01",
  forwarding_address: null,
  has_forwarding_address: false,
  return_by: null,
  returned_cents: null,
  deductions: [],
  returned_on: null,
  settled_at: null,
  ...o,
});

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DepositPanel tenancyId="t1" />
    </QueryClientProvider>,
  );

describe("DepositPanel (D6 track only)", () => {
  beforeEach(() => {
    state.rec = { side: "tenant", tenancy_status: "active", deposit: null };
    for (const f of [setDeposit, setForwardingAddress, settleDeposit]) f.mockClear();
  });

  it("tenant, none recorded: says so, nothing to press", async () => {
    renderPanel();
    expect(await screen.findByText("No deposit recorded.")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("landlord of a live tenancy records the amount and the day received", async () => {
    state.rec = { side: "landlord", tenancy_status: "active", deposit: null };
    renderPanel();
    const form = await screen.findByRole("form", { name: "Record the deposit" });
    fireEvent.change(within(form).getByLabelText("Deposit amount in dollars"), { target: { value: "1200" } });
    fireEvent.change(within(form).getByLabelText("Day you received it"), { target: { value: "2026-10-01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Record deposit" }));
    await waitFor(() => expect(setDeposit).toHaveBeenCalledWith("t1", 120000, "2026-10-01"));
  });

  it("tenant gives a forwarding address; the landlord of a live tenancy sees only that one was given", async () => {
    state.rec = { side: "tenant", tenancy_status: "active", deposit: D() };
    renderPanel();
    expect(await screen.findByText(/\$1,200\.00, received Oct 1, 2026\. Louisiana law: returned within one month/)).toBeTruthy();
    const form = screen.getByRole("form", { name: "Forwarding address" });
    fireEvent.change(within(form).getByLabelText("Forwarding address"), { target: { value: "500 New Home Rd, Baton Rouge LA 70801" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(setForwardingAddress).toHaveBeenCalledWith("t1", "500 New Home Rd, Baton Rouge LA 70801"));
  });

  it("landlord, live tenancy: no settle form yet, the address is not shown", async () => {
    state.rec = { side: "landlord", tenancy_status: "active", deposit: D({ has_forwarding_address: true }) };
    renderPanel();
    expect(await screen.findByText("Your tenant gave a forwarding address. You'll see it when the tenancy ends.")).toBeTruthy();
    expect(screen.queryByRole("form", { name: "Settle the deposit" })).toBeNull();
  });

  it("landlord after the end: the return-by date, the address, and an itemized settle (returned + kept = the deposit)", async () => {
    state.rec = { side: "landlord", tenancy_status: "ended", deposit: D({ forwarding_address: "500 New Home Rd, Baton Rouge LA 70801", has_forwarding_address: true, return_by: "2026-11-19" }) };
    renderPanel();
    expect(await screen.findByText("Return by Nov 19, 2026")).toBeTruthy();
    expect(screen.getByText("Send it to: 500 New Home Rd, Baton Rouge LA 70801")).toBeTruthy();
    const form = screen.getByRole("form", { name: "Settle the deposit" });
    fireEvent.click(within(form).getByRole("button", { name: "Keep part of it" }));
    const send = within(form).getByRole("button", { name: "Send the statement" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(within(form).getByLabelText("Reason kept 1"), { target: { value: "Carpet cleaning" } });
    fireEvent.change(within(form).getByLabelText("Amount kept 1"), { target: { value: "250" } });
    expect(within(form).getByText("$950.00")).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Day you returned it"), { target: { value: "2026-10-18" } });
    fireEvent.click(send);
    await waitFor(() => expect(settleDeposit).toHaveBeenCalledWith("t1", 95000, [{ reason: "Carpet cleaning", amount_cents: 25000 }], "2026-10-18"));
  });

  it("keeping more than the deposit is stopped before it is sent", async () => {
    state.rec = { side: "landlord", tenancy_status: "ended", deposit: D({ return_by: "2026-11-19" }) };
    renderPanel();
    const form = await screen.findByRole("form", { name: "Settle the deposit" });
    fireEvent.click(within(form).getByRole("button", { name: "Keep part of it" }));
    fireEvent.change(within(form).getByLabelText("Reason kept 1"), { target: { value: "Everything" } });
    fireEvent.change(within(form).getByLabelText("Amount kept 1"), { target: { value: "1500" } });
    expect(within(form).getByRole("alert").textContent).toBe("You can't keep more than the deposit.");
    expect((within(form).getByRole("button", { name: "Send the statement" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("settled: both sides see the statement, no more forms", async () => {
    state.rec = {
      side: "tenant",
      tenancy_status: "ended",
      deposit: D({ returned_cents: 95000, deductions: [{ reason: "Carpet cleaning", amount_cents: 25000 }], returned_on: "2026-11-01", settled_at: "2026-11-01T15:00:00Z" }),
    };
    renderPanel();
    const st = await screen.findByTestId("deposit-statement");
    expect(st.textContent).toContain("Returned $950.00 of $1,200.00 on Nov 1, 2026.");
    expect(st.textContent).toContain("Carpet cleaning: $250.00");
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("a failed load says so", async () => {
    state.rec = new Error("boom");
    renderPanel();
    expect(await screen.findByText("Couldn't load the deposit record.")).toBeTruthy();
  });
});
