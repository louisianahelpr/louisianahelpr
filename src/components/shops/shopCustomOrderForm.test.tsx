/**
 * Custom orders (20261106205852): the buyer orders a shop's price. A ready date from tomorrow on, on a day the shop
 * fills orders and not full (the server's rules), the shop's cancel rule read BEFORE paying, the payment line for the
 * request's plan, then shop-checkout 'order' with the request (never item lines) and the cancel terms shown, and the
 * Stripe page opens. A refusal stays on the form in plain words.
 *
 * @mutate src/components/shops/ShopCustomOrderForm.tsx |  const canSend = !!readyDate && dateProblem === null && !opening && price > 0; |  const canSend = !!readyDate && !opening && price > 0;
 * @mutate src/components/shops/ShopCustomOrderForm.tsx |      <p className="text-xs text-muted-foreground">{CUSTOM_ORDER_PAY_TEXT[request.payment_plan]}</p> |      <p className="text-xs text-muted-foreground">{CUSTOM_ORDER_PAY_TEXT.full_hold}</p>
 * @mutate src/lib/shops/orders.ts |    action: "order", shop_id: args.shopId, custom_request_id: args.requestId, ready_date: args.readyDate, note: args.note, |    action: "order", shop_id: args.shopId, ready_date: args.readyDate, note: args.note,
 * @mutate src/components/shops/ShopCustomOrderForm.tsx |      toast.error(shopsErrorMessage(err)); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CustomRequest } from "@/lib/shops/customRequests";

const db = vi.hoisted(() => ({ invoke: vi.fn(), terms: null as Record<string, unknown> | null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async (name: string) => (name === "shops_order_terms" ? { data: db.terms, error: null } : { data: null, error: null }),
    functions: { invoke: db.invoke },
  },
}));
const opened = vi.hoisted(() => ({ urls: [] as string[] }));
vi.mock("@/lib/openExternalUrl", () => ({
  openExternalUrl: async (url: string) => { opened.urls.push(url); },
}));
vi.mock("@/components/DatePickerField", () => ({
  DatePickerField: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} aria-label="Ready date" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
const setup = vi.hoisted(() => ({ cents: 0, known: true }));
vi.mock("@/hooks/useFirstPayoutFee", () => ({ useFirstPayoutFeeCents: () => setup.cents, useFirstPayoutFeeKnown: () => setup.known }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import ShopCustomOrderForm, { CUSTOM_ORDER_PAY_TEXT } from "./ShopCustomOrderForm";

const request = (over: Partial<CustomRequest> = {}): CustomRequest => ({
  id: "req-1", shop_id: "sh1", shop_name: "Bayou Cakes", role: "buyer", description: "A blue cake", wanted_date: null,
  payment_plan: "full_hold", status: "quoted", quote_cents: 4000, quote_note: null, quoted_at: "2026-11-07T10:00:00Z",
  expires_at: "2026-11-14T10:00:00Z", created_at: "2026-11-06T10:00:00Z", ...over,
});
function show(r = request()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}><MemoryRouter><ShopCustomOrderForm request={r} onDone={() => {}} /></MemoryRouter></QueryClientProvider>,
  );
}
const go = () => screen.getByRole("button", { name: "Go to payment" }) as HTMLButtonElement;

beforeEach(() => {
  // Monday 2026-11-09; the shop fills orders Monday to Saturday; Thursday the 12th is full.
  db.terms = { cancel_policy: "until_accept", ready_tap_cancel: "from_day_before", paused: false, open_weekdays: [1, 2, 3, 4, 5, 6],
    daily_order_cap: 5, today: "2026-11-09", last_day: "2027-02-07", full_days: ["2026-11-12"] };
  db.invoke.mockReset();
  db.invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.com/c/pay/cs_test_1" }, error: null });
  opened.urls = [];
  toast.error.mockClear();
  setup.cents = 0; setup.known = true;
});

describe("S2-015: the custom-order total includes a first-time setup fee", () => {
  it("shows the setup fee line and counts it in You pay before tax", async () => {
    setup.cents = 200;
    show();
    expect((await screen.findByTestId("shop-custom-order-setup-fee")).textContent).toBe("$2.00");
    expect(screen.getByTestId("shop-custom-order-total").textContent).toBe("$44.70");
  });
  it("no setup line when none is owed; an unknown fee is named in words", async () => {
    setup.known = false;
    show();
    expect((await screen.findByTestId("shop-custom-order-total")).textContent).toBe("$42.70");
    expect(screen.queryByTestId("shop-custom-order-setup-fee")).toBeNull();
    expect(screen.getByText(/one-time setup fee are added on the payment page/)).toBeTruthy();
  });
  it("the download Buy box counts the setup fee too", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "ShopDigitalBuy.tsx"), "utf8");
    expect(src).toMatch(/You pay \$\{formatCents\(picked\.price_cents \+ buyerFeeCents\(picked\.price_cents\) \+ setupFeeCents\)\}/);
    expect(src).toMatch(/useFirstPayoutFeeKnown\(\)/);
  });
});

describe("ordering a shop's price", () => {
  it("refuses today, a closed day and a full day; a good day orders THIS request with the terms shown, then opens the page", async () => {
    show();
    const date = await screen.findByLabelText("Ready date");
    for (const [bad, why] of [["2026-11-09", "Pick a day from tomorrow on."], ["2026-11-15", "The shop doesn't fill orders on that day."],
      ["2026-11-12", "That day is full. Pick another day."]] as const) {
      fireEvent.change(date, { target: { value: bad } });
      expect(go().disabled).toBe(true);
      expect(screen.getByText(why)).toBeTruthy();
    }
    fireEvent.change(date, { target: { value: "2026-11-10" } });
    expect(go().disabled).toBe(false);
    fireEvent.click(go());
    await waitFor(() => expect(opened.urls).toEqual(["https://checkout.stripe.com/c/pay/cs_test_1"]));
    const body = db.invoke.mock.calls[0][1].body as Record<string, unknown>;
    expect(body).toMatchObject({ action: "order", shop_id: "sh1", custom_request_id: "req-1", ready_date: "2026-11-10", note: "",
      terms: { cancel_policy: "until_accept", ready_tap_cancel: "from_day_before" } });
    expect(body).not.toHaveProperty("lines");
  });

  it("shows the price and the cancel rule before paying, and the payment line of the request's plan", async () => {
    show(request({ payment_plan: "deposit_50" }));
    await screen.findByLabelText("Ready date");
    expect(screen.getByText("$40.00")).toBeTruthy();
    expect(screen.getByText(/^Cancel rule: /)).toBeTruthy();
    expect(screen.getByText(CUSTOM_ORDER_PAY_TEXT.deposit_50)).toBeTruthy();
    expect(screen.queryByText(CUSTOM_ORDER_PAY_TEXT.full_hold)).toBeNull();
  });

  it("a refusal (the shop changed its terms) stays on the form in plain words; no page opens", async () => {
    db.invoke.mockResolvedValue({ data: null, error: Object.assign(new Error("terms_changed"), { context: { status: 409 } }) });
    show();
    fireEvent.change(await screen.findByLabelText("Ready date"), { target: { value: "2026-11-10" } });
    fireEvent.click(go());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(opened.urls).toEqual([]);
    expect(go().disabled).toBe(false);
  });
});
