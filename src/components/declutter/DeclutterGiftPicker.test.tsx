/**
 * Q2106 S5: the gift split the checkout shows matches the redeem's own arithmetic (redeem_gift_card_for_declutter_order,
 * 20261105030604: applied = least(cost, gift), a card part under $0.50 refused), Pay sends gift_card_id only when a
 * gift is picked, and only the redeem's refusals pass through in their own words.
 * @mutate src/components/declutter/DeclutterGiftPicker.tsx |     cardPartTooSmall: onCardCents > 0 && onCardCents < CARD_MINIMUM_CENTS, |     cardPartTooSmall: false,
 * @mutate src/components/declutter/DeclutterGiftPicker.tsx |   const fromGiftCents = Math.max(0, Math.min(payCents, giftCents)); |   const fromGiftCents = giftCents;
 * @mutate src/lib/declutter/api.ts |     ...(giftCardId ? { gift_card_id: giftCardId } : {}), |     ...{},
 * @mutate src/components/declutter/DeclutterGiftPicker.tsx |   /^This gift has expired$/, |   /^never$/,
 * @mutate src/components/declutter/DeclutterGiftPicker.tsx | c.claimed && c.amountCents > 0 && (!c.expiresAt \|\| new Date(c.expiresAt).getTime() > now) | c.claimed && c.amountCents > 0
 * @mutate src/hooks/useSpendableGiftCards.ts |             claimed: r.recipient_id === userId, |             claimed: true,
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const invoke = vi.fn(async (_fn: string, _opts: { body: Record<string, unknown> }) => ({ data: { url: "https://checkout.stripe.com/x" } as Record<string, unknown>, error: null }));
let rows: unknown[] = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (fn: string, opts: { body: Record<string, unknown> }) => invoke(fn, opts) },
    from: () => ({ select: () => ({ or: async () => ({ data: rows, error: null }) }) }),
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "me", email: "me@x.co" } }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { DeclutterGiftPicker, giftPayErrorMessage, giftSplit, giftSplitWords, giftsForCheckout } from "./DeclutterGiftPicker";
import { useSpendableGiftCards } from "@/hooks/useSpendableGiftCards";
import { latestFunctionDefs } from "@/test/helpers/rpcErrorInventory";

const lastBody = () => invoke.mock.calls[invoke.mock.calls.length - 1]?.[1].body;

describe("Q2106 S5 gift split", () => {
  it("a smaller gift pays its whole amount; the card pays the rest", () => {
    expect(giftSplit(805, 500)).toEqual({ fromGiftCents: 500, onCardCents: 305, leftOnGiftCents: 0, cardPartTooSmall: false });
    expect(giftSplitWords(giftSplit(805, 500))).toBe("$5 from your gift card, $3.05 on your card.");
  });
  it("a bigger gift covers it all and the rest stays on it", () => {
    expect(giftSplit(805, 2000)).toEqual({ fromGiftCents: 805, onCardCents: 0, leftOnGiftCents: 1195, cardPartTooSmall: false });
    expect(giftSplitWords(giftSplit(805, 805))).toBe("Your gift card covers it all.");
  });
  it("a card part of 1 to 49 cents is refused, 50 is fine (Stripe's floor, the redeem's rule)", () => {
    expect(giftSplit(805, 756).cardPartTooSmall).toBe(true);
    expect(giftSplit(805, 804).cardPartTooSmall).toBe(true);
    expect(giftSplit(805, 755).cardPartTooSmall).toBe(false);
    expect(giftSplitWords(giftSplit(805, 780))).toMatch(/^Your gift card covers all but \$0\.25, and a card payment has to be at least \$0\.50\./);
  });
  it("no complete total yet: no figures", () => {
    expect(giftSplitWords(null)).toBe("Your gift card pays first. What's left goes on your card.");
  });
});

describe("Q2106 S5 gifts offered", () => {
  it("only claimed gifts with something on them", () => {
    const cards = [
      { id: "a", amountCents: 500, expiresAt: null, claimed: true },
      { id: "b", amountCents: 500, expiresAt: null, claimed: false },
      { id: "c", amountCents: 0, expiresAt: null, claimed: true },
    ];
    expect(giftsForCheckout(cards).map((c) => c.id)).toEqual(["a"]);
    // A gift that expired while the screen sat open is never offered (the read filters it too).
    const now = Date.parse("2026-11-05T06:00:00Z");
    expect(giftsForCheckout([{ id: "old", amountCents: 500, expiresAt: "2026-11-05T05:59:59Z", claimed: true },
      { id: "new", amountCents: 500, expiresAt: "2026-11-05T06:00:01Z", claimed: true }], now).map((c) => c.id)).toEqual(["new"]);
  });

  it("useSpendableGiftCards carries the amount, expiry and whether the buyer claimed it", async () => {
    rows = [
      { id: "g-mine", amount: 25, status: "sent", payment_status: "paid", expires_at: null, recipient_id: "me" },
      { id: "g-email", amount: "12.5", status: "sent", payment_status: "paid", expires_at: null, recipient_id: null },
    ];
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useSpendableGiftCards(), { wrapper });
    await waitFor(() => expect(result.current.cards).toHaveLength(2));
    expect(result.current.cards).toEqual([
      { id: "g-email", amountCents: 1250, expiresAt: null, claimed: false },
      { id: "g-mine", amountCents: 2500, expiresAt: null, claimed: true },
    ]);
    expect(result.current.ids).toEqual(["g-email", "g-mine"]);
  });

  it("draws nothing without a gift", () => {
    const { container } = render(<DeclutterGiftPicker gifts={[]} value={null} onChange={() => {}} split={null} error={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("names each choice by its own words and shows a refusal as an alert", () => {
    render(<DeclutterGiftPicker gifts={[{ id: "a", amountCents: 7500, expiresAt: "2026-12-03T12:00:00Z", claimed: true }]}
      value="a" onChange={() => {}} split={giftSplit(805, 7500)} error="This gift has expired" />);
    expect(screen.getByRole("radio", { name: /Use my \$75 gift card/ })).toBeChecked();
    expect(screen.getByText(/^Use by /)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("This gift has expired");
  });
});

describe("Q2106 S5 refusals", () => {
  it("passes the redeem's sentences through and nothing else", () => {
    expect(giftPayErrorMessage(new Error("This gift has expired"))).toBe("This gift has expired");
    expect(giftPayErrorMessage(new Error("This gift is set aside for something else"))).toBe("This gift is set aside for something else");
    expect(giftPayErrorMessage(new Error("This gift has not been funded yet"))).toBe("This gift has not been funded yet");
    const small = "Your gift covers all but $0.25 of this order, and a card payment has to be at least $0.50. Add or remove an item so the gift covers all of it, or leaves at least $0.50 to pay by card.";
    expect(giftPayErrorMessage(new Error(small))).toBe(small);
    expect(giftPayErrorMessage(new Error("This gift is not yours to redeem"))).toBe("This gift card can't be used here. Choose another, or pay by card.");
    expect(giftPayErrorMessage(new Error("payment_unavailable"))).toBeNull();
    expect(giftPayErrorMessage(new Error("slot_unavailable"))).toBeNull();
    expect(giftPayErrorMessage(null)).toBeNull();
  });

  it("every refusal the redeem raises for the buyer is recognised (its newest definition)", () => {
    const fn = latestFunctionDefs("supabase/migrations").get("redeem_gift_card_for_declutter_order");
    expect(fn).toBeTruthy();
    // The $% placeholders of the under-$0.50 refusal are filled with a real amount.
    const raised = [...fn!.body.matchAll(/RAISE EXCEPTION '([^']+)'[^;]*?USING ERRCODE = '(P0001|42501|PT404)'/g)]
      .map((m) => m[1].replace("$%.%", "$0.25"))
      // The order-level refusals (not found, not yours, no longer payable) are not about the gift: the usual message.
      .filter((r) => /gift/i.test(r));
    expect(raised.length).toBeGreaterThan(6);
    for (const r of raised) expect(giftPayErrorMessage(new Error(r)), r).not.toBeNull();
  });
});

describe("Q2106 S5 Pay body", () => {
  beforeEach(() => invoke.mockClear());
  it("sends gift_card_id only when a gift is picked, and reads gift_cents back", async () => {
    const { startCheckoutPayment } = await import("@/lib/declutter/api");
    await startCheckoutPayment("s1", "porch", null, null, null, null, "11111111-1111-4111-8111-111111111111");
    expect(lastBody()).toMatchObject({ action: "pay", handover: "porch", gift_card_id: "11111111-1111-4111-8111-111111111111" });
    await startCheckoutPayment("s1", "porch");
    expect(lastBody()).not.toHaveProperty("gift_card_id");
    invoke.mockResolvedValueOnce({ data: { paid: true, gift_cents: 805 }, error: null });
    expect(await startCheckoutPayment("s1", "porch", null, null, null, null, "11111111-1111-4111-8111-111111111111"))
      .toEqual({ url: null, paid: true, giftCents: 805 });
  });
});
