/**
 * Custom orders (20261106205852; lead 11-06 seller statements): the shop's price form on a buyer's request. The price
 * is $1 to $5,000 with at most 2 decimals; the shop names what it is making and ticks the SAME statements as listing
 * that kind (changing the kind or type clears them); home food first confirms this year's home-kitchen limit. What is
 * sent is exactly the request, the price in cents, the trimmed note, the type and the statements that kind needs.
 *
 * @mutate src/components/shops/ShopCustomQuoteForm.tsx |  const priceOk = cents !== null && cents >= 100 && cents <= SHOP_ITEM_MAX_PRICE_CENTS; |  const priceOk = cents !== null;
 * @mutate src/components/shops/ShopCustomQuoteForm.tsx |  const allTicked = need.every((k) => ticked.includes(k)); |  const allTicked = true;
 * @mutate src/components/shops/ShopCustomQuoteForm.tsx |            setTicked([]);\n          }}\n        >\n          {CUSTOM_QUOTE_KINDS |            setTicked((t) => t);\n          }}\n        >\n          {CUSTOM_QUOTE_KINDS
 * @mutate src/components/shops/ShopCustomQuoteForm.tsx |      if (cottageNeedsTick) await confirmCottageYear(); |
 * @mutate src/components/shops/ShopCustomQuoteForm.tsx |  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null; |  if (!/^\d+(\.\d+)?$/.test(t)) return null;
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const db = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: db.rpc } }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import ShopCustomQuoteForm, { quoteCents } from "./ShopCustomQuoteForm";
import { requiredStatements } from "@/lib/shops/items";

const onDone = vi.fn();
function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShopCustomQuoteForm requestId="req-1" onDone={onDone} /></QueryClientProvider>);
}
const form = () => screen.getByTestId("shop-custom-quote-form");
const sendBtn = () => screen.getByRole("button", { name: "Send price" }) as HTMLButtonElement;
const tickAll = () => within(form()).getAllByRole("checkbox").forEach((c) => {
  if (c.getAttribute("aria-checked") !== "true") fireEvent.click(c);
});
const price = (v: string) => fireEvent.change(screen.getByLabelText("Price (dollars)"), { target: { value: v } });

beforeEach(() => {
  db.rpc.mockReset();
  db.rpc.mockImplementation(async (name: string) => {
    if (name === "shops_my_cottage_status") return { data: { confirmed: false, reached: false, cap_cents: 2000000 }, error: null };
    return { data: null, error: null };
  });
  toast.success.mockClear();
  toast.error.mockClear();
  onDone.mockClear();
});

describe("quoteCents", () => {
  it("reads dollars with at most 2 decimals, a $ and commas; anything else is no price", () => {
    expect(quoteCents("40")).toBe(4000);
    expect(quoteCents(" $1,250.5 ")).toBe(125050);
    expect(quoteCents("12.345")).toBeNull();
    expect(quoteCents("0")).toBeNull();
    expect(quoteCents("-5")).toBeNull();
    expect(quoteCents("ten")).toBeNull();
  });
});

describe("the shop's price form", () => {
  it("sends only with a price in range and every statement the kind needs, then exactly those values", async () => {
    show();
    expect(sendBtn().disabled).toBe(true);
    price("40");
    expect(sendBtn().disabled).toBe(true); // statements not ticked
    tickAll();
    expect(sendBtn().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Note for the buyer (optional)"), { target: { value: "  Two weeks.  " } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const call = db.rpc.mock.calls.find(([n]) => n === "shops_quote_custom_request");
    const subtype = (screen.queryByLabelText("Type") as HTMLSelectElement | null)?.value;
    expect(call?.[1]).toEqual({ p_request_id: "req-1", p_quote_cents: 4000, p_note: "Two weeks.", p_subtype: subtype,
      p_statements: requiredStatements("made", subtype as string) });
    expect(toast).toHaveBeenCalledWith("Price sent. The buyer has 7 days to order it; you then accept the order within 24 hours.");
  });

  it("a price under $1, over $5,000 or with 3 decimals never sends", () => {
    show();
    tickAll();
    for (const bad of ["0.50", "5000.01", "12.345"]) {
      price(bad);
      expect(sendBtn().disabled).toBe(true);
    }
    price("5000");
    expect(sendBtn().disabled).toBe(false);
  });

  it("changing the kind clears the statements (each kind has its own)", () => {
    show();
    price("40");
    tickAll();
    expect(sendBtn().disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("What kind of order"), { target: { value: "service" } });
    expect(within(form()).getAllByRole("checkbox").every((c) => c.getAttribute("aria-checked") !== "true")).toBe(true);
    expect(sendBtn().disabled).toBe(true);
  });

  it("home food: the yearly home-kitchen limit is confirmed first, then the price is sent", async () => {
    show();
    fireEvent.change(screen.getByLabelText("What kind of order"), { target: { value: "home_food" } });
    await screen.findByText(/under \$20,000 \(the Louisiana limit\)/);
    price("30");
    tickAll();
    fireEvent.click(sendBtn());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const names = db.rpc.mock.calls.map(([n]) => n).filter((n) => n !== "shops_my_cottage_status");
    expect(names).toEqual(["shops_confirm_cottage_year", "shops_quote_custom_request"]);
  });

  it("a refusal reads in plain words and the form stays open", async () => {
    db.rpc.mockImplementation(async (name: string) => (name === "shops_quote_custom_request"
      ? { data: null, error: { message: "attestation_incomplete", code: "22023" } } : { data: null, error: null }));
    show();
    price("40");
    tickAll();
    fireEvent.click(sendBtn());
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(String(toast.error.mock.calls[0][0])).not.toMatch(/attestation_incomplete/);
    expect(onDone).not.toHaveBeenCalled();
  });
});
