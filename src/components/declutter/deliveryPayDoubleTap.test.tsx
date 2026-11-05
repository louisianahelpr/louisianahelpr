/**
 * A double tap on a Declutter delivery pay button starts ONE payment (Q2709 delivery pay packet, lead 11-05): while the
 * start call is in flight, "Raise the pay" and "Tip $N" are disabled and read "Opening payment…", and the raise
 * form's own submit guard refuses a second submit. The start calls are held pending so the in-flight state is what
 * the second tap meets: the test waits for the button to read "Opening payment…" before tapping again (a real second
 * tap lands after React re-renders; two clicks inside one JS tick both run before TanStack's notifyManager flushes
 * isPending, for the old hand-made button and the shared Button alike).
 *
 * @mutate src/components/declutter/DeliveryRaisePanel.tsx | if (valid && !busy) raise.mutate(cents); | if (valid) raise.mutate(cents);
 * @mutate src/components/declutter/DeliveryTipPanel.tsx | disabled={!valid \|\| busy} onClick={() => send.mutate(cents)}> | disabled={!valid} onClick={() => send.mutate(cents)}>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ raises: [] as unknown[][], tips: [] as unknown[][] }));
const never = () => new Promise<never>(() => {});
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());
vi.mock("@/lib/declutter/deliveryRaise", () => ({
  fetchDeliveryRaiseStatus: async () => ({
    order_id: "o1", task_status: "open", open_until: "2026-10-23T20:00:00Z", delivery_cents: 2000, raised_cents: 0,
    can_raise: true, room_cents: 15000, raises: [],
  }),
  startDeliveryRaise: (...a: unknown[]) => { h.raises.push(a); return never(); },
}));
vi.mock("@/lib/declutter/deliveryTip", () => ({
  fetchMyPaidDeliveryTips: async () => [],
  startDeliveryTip: (...a: unknown[]) => { h.tips.push(a); return never(); },
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: async () => {} }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" } }) }));

import { DeliveryRaisePanel } from "./DeliveryRaisePanel";
import { DeliveryTipPanel } from "./DeliveryTipPanel";

function show(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  h.raises = [];
  h.tips = [];
});

describe("delivery pay buttons start one payment per tap burst (Q2709)", () => {
  it("Raise the pay: a double tap and a double submit start one raise, the button disabled while it opens", async () => {
    show(<DeliveryRaisePanel orderId="o1" />);
    const btn = (await screen.findByRole("button", { name: "Raise the pay" })) as HTMLButtonElement;
    const form = btn.closest("form")!;
    fireEvent.click(btn);
    const busy = (await screen.findByRole("button", { name: "Opening payment…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    fireEvent.submit(form);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.raises).toEqual([["o1", 1000]]);
  });

  it("Tip: a double tap starts one tip, the button disabled while it opens", async () => {
    show(<DeliveryTipPanel taskId="t1" helprFirstName="Marcus" />);
    fireEvent.click(await screen.findByRole("button", { name: /^\$5/ }));
    const btn = screen.getByRole("button", { name: "Tip $5.00" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    const busy = (await screen.findByRole("button", { name: "Opening payment…" })) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.tips.length).toBe(1);
    expect(h.tips[0].slice(0, 2)).toEqual(["t1", 500]);
  });
});
