/**
 * Vacuity 44108754883 (isolation): SellTradesRow was rendered only on its own
 * (declutterTradesPrompt.test.tsx); nothing rendered SellSummaryCard, the card
 * that mounts it below Condition, so a broken mount (wrong props, never drawn)
 * stayed green. This renders the card and finds the row in it, and that a free
 * listing's card leaves it out.
 *
 * @mutate src/components/declutter/SellSummaryCard.tsx |         <SellTradesRow s={s} /> |         {null}
 */
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { SellSummaryCard } from "@/components/declutter/SellSummaryCard";

/** Every table read answers empty; every RPC answers null. */
vi.mock("@/integrations/supabase/client", () => {
  const empty = { data: [], error: null, count: 0 };
  const builder = (): unknown =>
    new Proxy(() => {}, {
      get: (_t, k) => (k === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(empty).then(ok) : () => builder()),
      apply: () => builder(),
    });
  return {
    supabase: {
      from: () => builder(),
      rpc: async () => ({ data: null, error: null }),
      auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
    },
  };
});

type Flow = Parameters<typeof SellSummaryCard>[0]["s"];

const flow = (free: boolean): Flow =>
  ({
    form: { title: "Oak chair", free, price: "20", category: "furniture", conditionStars: 4, description: "", deliverySize: "small" },
    set: vi.fn(),
    ai: { state: { status: "idle" } },
    hintAt: null,
    priceCents: free ? 0 : 2000,
    sizeKnown: true,
    setSizePicked: vi.fn(),
    tradesWanted: false,
    setTradesWanted: vi.fn(),
  }) as unknown as Flow;

const mount = (free: boolean) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <SellSummaryCard s={flow(free)} open={null} setOpen={() => {}} priceExtras={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("SellSummaryCard mounts the trades row", () => {
  it("a priced listing's card shows Open to trades? below Condition", () => {
    const { container } = mount(false);
    const row = container.querySelector("[data-sell-trades]");
    expect(row).not.toBeNull();
    expect(screen.getByRole("switch", { name: /Open to trades\?/ })).toBeTruthy();
    const rows = [...container.querySelectorAll("[data-sell-summary] > *")];
    expect(rows.length).toBeGreaterThan(4);
  });

  it("a free listing's card leaves it out", () => {
    const { container } = mount(true);
    expect(container.querySelector("[data-sell-summary]")).not.toBeNull();
    expect(container.querySelector("[data-sell-trades]")).toBeNull();
  });
});
