/**
 * Homes rent tracker, pay direct (D2/D10/D11, R1-R5): the record both sides see. The server side (who may
 * act, validation, the sweep, late fees, balance) is proven by src/test/pglite/homesRentTracker.pglite.mjs;
 * this pins the screen: what each side sees and that each control sends the right call.
 *
 * @mutate src/components/rentals/RentPanel.tsx |       return addRentPayment(tenancyId, cents, paidOn, method); |       return addRentPayment(tenancyId, 0, paidOn, method);
 * @mutate src/components/rentals/RentPanel.tsx |     mutationFn: (received: boolean) => decideRentPayment(p.id, received, received ? undefined : reason.trim()), |     mutationFn: (received: boolean) => decideRentPayment(p.id, true, undefined),
 * @mutate src/components/rentals/RentPanel.tsx |             {p.status === "confirmed" && ( |             {p.status !== "declined" && (
 * @mutate src/components/rentals/RentPanel.tsx |             {l.side === "landlord" && !c.waived && ( |             {!c.waived && (
 * @mutate src/components/rentals/RentPanel.tsx |       {warning && ( |       {false && (
 * @mutate src/components/rentals/RentPanel.tsx |       {l.side === "landlord" && (editing \|\| !l.plan) && <PlanForm |       {(editing \|\| !l.plan) && <PlanForm
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RentLedger } from "@/lib/rentals/rent";

const state: { ledger: RentLedger | Error } = { ledger: undefined as unknown as RentLedger };
const setRentPlan = vi.fn(async (..._a: unknown[]) => undefined);
const addRentPayment = vi.fn(async (..._a: unknown[]) => "pay1");
const decideRentPayment = vi.fn(async (..._a: unknown[]) => undefined);
const waiveRentCharge = vi.fn(async (..._a: unknown[]) => undefined);
const saveRentReceipt = vi.fn(async (..._a: unknown[]) => undefined);

vi.mock("@/lib/rentals/rent", async (orig) => ({
  ...(await orig<typeof import("@/lib/rentals/rent")>()),
  fetchRentLedger: async () => {
    if (state.ledger instanceof Error) throw state.ledger;
    return state.ledger;
  },
  setRentPlan: (...a: unknown[]) => setRentPlan(...a),
  addRentPayment: (...a: unknown[]) => addRentPayment(...a),
  decideRentPayment: (...a: unknown[]) => decideRentPayment(...a),
  waiveRentCharge: (...a: unknown[]) => waiveRentCharge(...a),
}));
vi.mock("@/lib/rentals/rentReceipt", () => ({ saveRentReceipt: (...a: unknown[]) => saveRentReceipt(...a) }));

import { RentPanel } from "./RentPanel";

const PLAN = { amount_cents: 120000, frequency: "monthly" as const, first_due_on: "2026-10-01", grace_days: 3, late_fee_cents: 5000, pay_methods: ["zelle" as const, "check" as const], next_due_on: "2026-11-01" };
const L = (o: Partial<RentLedger> = {}): RentLedger => ({
  side: "tenant",
  home: { label: "Oak house", unit_label: "Main", city: "Lafayette", zip_code: "70501" },
  plan: PLAN,
  balance_cents: 120000,
  charges: [{ id: "c1", kind: "rent", due_on: "2026-10-01", amount_cents: 120000, waived: false }],
  payments: [],
  ...o,
});

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RentPanel tenancyId="t1" />
    </QueryClientProvider>,
  );

describe("RentPanel (D2 pay direct)", () => {
  beforeEach(() => {
    state.ledger = L();
    for (const f of [setRentPlan, addRentPayment, decideRentPayment, waiveRentCharge, saveRentReceipt]) f.mockClear();
  });

  it("tenant, no schedule yet: says so, no I paid", async () => {
    state.ledger = L({ plan: null, charges: [], balance_cents: 0 });
    renderPanel();
    expect(await screen.findByText("Your landlord hasn't set a rent schedule yet.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "I paid" })).toBeNull();
    expect(screen.queryByRole("form", { name: "Rent schedule" })).toBeNull();
  });

  it("tenant: the schedule, what is owed, how to pay; I paid sends amount, date and method", async () => {
    renderPanel();
    expect(await screen.findByText("You owe $1,200.00")).toBeTruthy();
    expect(screen.getByText(/\$1,200\.00 every month · next due Nov 1, 2026/)).toBeTruthy();
    expect(screen.getByText(/Late fee \$50\.00 if rent is still open more than 3 days after the due date\. Paid directly to the landlord by Zelle, Check\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I paid" }));
    const form = screen.getByRole("form", { name: "I paid" });
    fireEvent.change(within(form).getByLabelText("Amount paid in dollars"), { target: { value: "500" } });
    fireEvent.change(within(form).getByLabelText("Date paid"), { target: { value: "2026-10-02" } });
    fireEvent.change(within(form).getByLabelText("How it was paid"), { target: { value: "check" } });
    fireEvent.click(within(form).getByRole("button", { name: "Send to landlord" }));
    await waitFor(() => expect(addRentPayment).toHaveBeenCalledWith("t1", 50000, "2026-10-02", "check"));
  });

  it("tenant: a waiting payment is named; a declined one shows why; no waive control", async () => {
    state.ledger = L({
      payments: [
        { id: "p1", amount_cents: 50000, paid_on: "2026-10-02", method: "zelle", reported_by: "tenant", status: "reported", decline_reason: null, decided_at: null },
        { id: "p2", amount_cents: 70000, paid_on: "2026-10-03", method: "check", reported_by: "tenant", status: "declined", decline_reason: "The check bounced.", decided_at: "2026-10-04T15:00:00Z" },
      ],
    });
    renderPanel();
    expect(await screen.findByText("1 payment is waiting for your landlord to confirm.")).toBeTruthy();
    expect(screen.getByText("Not received: The check bounced.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Waive/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Rent received" })).toBeNull();
  });

  it("R5: a receipt for each CONFIRMED payment only, naming the home and the amount", async () => {
    state.ledger = L({
      payments: [
        { id: "abcdef12-0000-0000-0000-000000000000", amount_cents: 120000, paid_on: "2026-10-01", method: "zelle", reported_by: "tenant", status: "confirmed", decline_reason: null, decided_at: "2026-10-01T18:00:00Z" },
        { id: "p2", amount_cents: 10000, paid_on: "2026-10-03", method: "cash", reported_by: "tenant", status: "reported", decline_reason: null, decided_at: null },
      ],
    });
    renderPanel();
    const buttons = await screen.findAllByRole("button", { name: "Receipt" });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]);
    expect(saveRentReceipt).toHaveBeenCalledTimes(1);
    const [name, text] = saveRentReceipt.mock.calls[0] as [string, string];
    expect(name).toBe("rent-receipt-2026-10-01-abcdef12.txt");
    expect(text).toContain("Receipt no.: ABCDEF12");
    expect(text).toContain("Home: Oak house, Main, Lafayette 70501");
    expect(text).toContain("Amount: $1,200.00");
    expect(text).toContain("Paid by: Zelle, directly to the landlord");
  });

  it("landlord, no schedule: the form; a late fee over 10% warns (never blocks); save sends cents and the ways to pay", async () => {
    state.ledger = L({ side: "landlord", plan: null, charges: [], balance_cents: 0 });
    renderPanel();
    const form = await screen.findByRole("form", { name: "Rent schedule" });
    fireEvent.change(within(form).getByLabelText("Rent amount in dollars"), { target: { value: "1000" } });
    fireEvent.change(within(form).getByLabelText("How often"), { target: { value: "biweekly" } });
    fireEvent.change(within(form).getByLabelText(/First due date/), { target: { value: "2099-01-05" } });
    fireEvent.change(within(form).getByLabelText("Grace days"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Late fee in dollars"), { target: { value: "150" } });
    expect(within(form).getByRole("alert").textContent).toContain("more than 10% of the rent");
    const save = within(form).getByRole("button", { name: "Save rent schedule" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(within(form).getByLabelText("Zelle"));
    fireEvent.click(within(form).getByLabelText("Cash"));
    fireEvent.click(save);
    await waitFor(() =>
      expect(setRentPlan).toHaveBeenCalledWith("t1", { amount_cents: 100000, frequency: "biweekly", first_due_on: "2099-01-05", grace_days: 2, late_fee_cents: 15000, pay_methods: ["zelle", "cash"] }),
    );
  });

  it("landlord: Rent received confirms; Not received needs a reason the tenant sees", async () => {
    state.ledger = L({
      side: "landlord",
      payments: [{ id: "p1", amount_cents: 50000, paid_on: "2026-10-02", method: "zelle", reported_by: "tenant", status: "reported", decline_reason: null, decided_at: null }],
    });
    renderPanel();
    expect(await screen.findByText("Owed to you: $1,200.00")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Rent received" }));
    await waitFor(() => expect(decideRentPayment).toHaveBeenCalledWith("p1", true, undefined));
    fireEvent.click(screen.getByRole("button", { name: "Not received" }));
    const send = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Why it wasn't received"), { target: { value: "Nothing arrived." } });
    fireEvent.click(send);
    await waitFor(() => expect(decideRentPayment).toHaveBeenLastCalledWith("p1", false, "Nothing arrived."));
  });

  it("landlord: records a payment and waives a charge (kept on the record)", async () => {
    state.ledger = L({ side: "landlord" });
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Record a payment" }));
    const form = screen.getByRole("form", { name: "Record a payment" });
    fireEvent.change(within(form).getByLabelText("Amount paid in dollars"), { target: { value: "1200" } });
    fireEvent.click(within(form).getByRole("button", { name: "Record payment" }));
    await waitFor(() => expect(addRentPayment).toHaveBeenCalledWith("t1", 120000, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), "zelle"));
    fireEvent.click(screen.getByRole("button", { name: "Waive rent due Oct 1, 2026" }));
    await waitFor(() => expect(waiveRentCharge).toHaveBeenCalledWith("c1"));
  });

  it("a failed load says so", async () => {
    state.ledger = new Error("boom");
    renderPanel();
    expect(await screen.findByText("Couldn't load the rent record.")).toBeTruthy();
  });
});
