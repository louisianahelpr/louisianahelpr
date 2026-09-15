import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SubscriptionTab } from "./SubscriptionTab";
import { tierConfig } from "./subscriptionTab/tierConfig";

/**
 * VN-44 (owner, 2026-09-14): "the SAME perks list must show when Once or Annual
 * is selected". The billing toggle changes the PRICE and the one explainer box
 * above the cards — never what a tier includes. A one-time pass and an annual
 * plan grant exactly the perks a monthly plan grants (stripe-webhook stamps the
 * same `subscription_tier`; every gate reads the tier, not the cycle).
 *
 * The defect this pins: the Once tab rewrote "every month" to "for your 30
 * days", so Pro's and Plus's boost perk read differently on Once than on
 * Monthly and Annual. Rendered, not grepped — the assertion is about what a
 * member sees after pressing the toggle, which is the only thing the owner
 * judged.
 */

// No Supabase mock (CLAUDE.md: no new mocked-Supabase specs). Nothing asserted
// here touches the backend: the cards render from tierConfig, and the only
// network calls (refresh, checkout, portal) sit behind buttons this never presses.
vi.mock("@/lib/iap", () => ({
  isIapAvailable: () => false,
  purchaseTier: vi.fn(),
  restorePurchases: vi.fn(),
  IapBlockedError: class IapBlockedError extends Error {},
}));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn() }));
vi.mock("@/lib/nativeInit", () => ({ isNativePlatform: false }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/haptics", () => ({ hapticLight: vi.fn(), hapticError: vi.fn(), hapticSuccess: vi.fn() }));

type Cycle = "Once" | "Monthly" | "Annual";

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/profile?tab=subscription"]}>
        <SubscriptionTab profile={null} user={null} onBack={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** tier name -> the bullet texts its card shows, plus the "+ Everything in" eyebrow. */
function readCards(): Record<string, { bullets: string[]; eyebrow: string | null }> {
  const out: Record<string, { bullets: string[]; eyebrow: string | null }> = {};
  for (const heading of screen.getAllByRole("heading", { level: 2 })) {
    const card = heading.closest("div.grid") as HTMLElement | null;
    expect(card, `no card grid around the "${heading.textContent}" heading`).toBeTruthy();
    const list = within(card!).getByRole("list");
    const bullets = within(list).getAllByRole("listitem").map((li) => li.textContent?.trim() ?? "");
    const eyebrow = Array.from(card!.querySelectorAll("p"))
      .map((p) => p.textContent?.trim() ?? "")
      .find((t) => /^\+ Everything in/.test(t)) ?? null;
    out[heading.textContent!.trim()] = { bullets, eyebrow };
  }
  return out;
}

function select(cycle: Cycle) {
  fireEvent.click(screen.getByRole("button", { name: cycle }));
}

describe("Membership cards show the same perks on every billing cycle (VN-44)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a card for every tier in tierConfig", () => {
    renderTab();
    expect(Object.keys(readCards())).toEqual(tierConfig.map((t) => t.name));
  });

  it.each<Cycle>(["Once", "Annual"])("%s shows exactly Monthly's perks, card for card", (cycle) => {
    renderTab();
    select("Monthly");
    const monthly = readCards();
    select(cycle);
    const other = readCards();

    for (const tier of Object.keys(monthly)) {
      expect(
        other[tier].bullets.length,
        `${tier} on ${cycle} shows ${other[tier].bullets.length} perks; Monthly shows ${monthly[tier].bullets.length}`,
      ).toBeGreaterThanOrEqual(monthly[tier].bullets.length);
      expect(other[tier], `${tier}'s perks differ between Monthly and ${cycle}`).toEqual(monthly[tier]);
    }
  });

  it("and the list is the tier's configured perks, not a cycle-specific rewrite", () => {
    renderTab();
    for (const cycle of ["Once", "Monthly", "Annual"] as Cycle[]) {
      select(cycle);
      const cards = readCards();
      for (const t of tierConfig) {
        const configured = t.features.filter((f) => !/^Everything in/i.test(f));
        // First bullet is the fee line; the rest are the tier's own perks, verbatim.
        expect(cards[t.name].bullets.slice(1), `${t.name} on ${cycle}`).toEqual(configured);
      }
    }
  });

  it("the price is what changes between cycles", () => {
    renderTab();
    const plus = tierConfig.find((t) => t.id === "plus")!;
    const priceOn = (cycle: Cycle) => {
      select(cycle);
      const heading = screen.getByRole("heading", { level: 2, name: plus.name });
      return within(heading.closest("div.grid") as HTMLElement).getByText(/^\$/).textContent;
    };
    expect(priceOn("Monthly")).toBe(plus.monthly);
    expect(priceOn("Annual")).toBe(plus.annual);
    expect(priceOn("Once")).toBe(plus.oneTime);
  });
});
