/**
 * The buyer's "Raise the pay" panel (Q1929, spec row 40; migration
 * 20261021130506). The amounts and the rules are proven in SQL by
 * src/test/pglite/declutterDeliveryRaise.pglite.mjs; this proves the panel
 * shows the honest price of the second payment (raise + card fee, the same
 * formula as the SQL) and sends exactly the raise the buyer typed.
 *
 * @mutate src/components/declutter/DeliveryRaisePanel.tsx |  const fee = valid ? raiseCardFeeCents(cents) : 0; |  const fee = 0;
 * @mutate src/components/declutter/DeliveryRaisePanel.tsx |  const valid = /^\d+$/.test(dollars) && cents >= RAISE_MIN_CENTS && cents <= s.room_cents; |  const valid = /^\d+$/.test(dollars);
 * @mutate src/components/declutter/DeliveryRaisePanel.tsx |  if (!s \|\| (!s.can_raise && s.raises.length === 0)) return null; |  if (!s) return null;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  status: null as unknown,
  error: null as Error | null,
  started: [] as unknown[][],
  opened: [] as string[],
  reads: 0,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/declutter/deliveryRaise", () => ({
  fetchDeliveryRaiseStatus: async () => { state.reads++; if (state.error) throw state.error; return state.status; },
  startDeliveryRaise: async (...a: unknown[]) => { state.started.push(a); return { url: "https://checkout.stripe.test/raise", paid: false }; },
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: async (url: string) => { state.opened.push(url); } }));

import { DeliveryRaisePanel } from "./DeliveryRaisePanel";

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DeliveryRaisePanel orderId="o1" /></QueryClientProvider>);
}
const STATUS = {
  order_id: "o1", task_status: "open", open_until: "2026-10-23T20:00:00Z", delivery_cents: 2000, raised_cents: 0,
  can_raise: true, room_cents: 15000, raises: [],
};

beforeEach(() => {
  state.status = STATUS;
  state.error = null;
  state.started = [];
  state.opened = [];
  state.reads = 0;
});

describe("DeliveryRaisePanel", () => {
  it("while no Helpr has it: the raise, its card fee and the total, each shown", async () => {
    show();
    expect(await screen.findByRole("heading", { name: "Raise the pay" })).toBeTruthy();
    expect(screen.getByText("Added to the Helpr's pay").nextSibling?.textContent).toBe("$10");
    expect(screen.getByText("Card fee").nextSibling?.textContent).toBe("$0.61");
    expect(screen.getByText("You pay now").nextSibling?.textContent).toBe("$10.61");
    expect(screen.getByText(/all of it comes back with your delivery fee/)).toBeTruthy();
  });

  it("sends exactly the raise typed, then opens the payment page", async () => {
    show();
    const input = await screen.findByLabelText("Add to the pay");
    fireEvent.change(input, { target: { value: "25" } });
    expect(screen.getByText("Card fee").nextSibling?.textContent).toBe("$1.06");
    fireEvent.click(screen.getByRole("button", { name: "Raise the pay" }));
    await waitFor(() => expect(state.opened).toEqual(["https://checkout.stripe.test/raise"]));
    expect(state.started).toEqual([["o1", 2500]]);
  });

  it("under $5 or over what is left to raise cannot be sent", async () => {
    state.status = { ...STATUS, raised_cents: 14000, room_cents: 1000 };
    show();
    const input = await screen.findByLabelText("Add to the pay");
    fireEvent.change(input, { target: { value: "4" } });
    expect((screen.getByRole("button", { name: "Raise the pay" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "11" } });
    expect((screen.getByRole("button", { name: "Raise the pay" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "10" } });
    expect((screen.getByRole("button", { name: "Raise the pay" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText(/up to \$10\./)).toBeTruthy();
  });

  it("once a Helpr has it (or it closed): no raise form, only what happened to earlier raises", async () => {
    state.status = { ...STATUS, can_raise: false, task_status: "unfilled",
      raises: [{ raise_cents: 1000, card_fee_cents: 61, total_cents: 1061, status: "refunding", refund_reason: "no_helpr", paid_at: "2026-10-21T10:00:00Z" }] };
    show();
    expect(await screen.findByText("Your $10.61 raise payment is coming back to your card.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Raise the pay" })).toBeNull();
  });

  it("nothing to raise and no raises: nothing at all", async () => {
    state.status = { ...STATUS, can_raise: false };
    const { container } = show();
    // Wait for the read to land and the panel to render with it (before it lands the panel is empty anyway).
    await waitFor(() => expect(state.reads).toBe(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe("");
  });

  it("a read that fails says so with a retry (not an empty space)", async () => {
    state.error = new Error("network");
    show();
    expect(await screen.findByText("We couldn't load the delivery pay.")).toBeTruthy();
  });
});
