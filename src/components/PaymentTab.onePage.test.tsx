/**
 * Q1177: PaymentTab is the Money tab's PAYOUT ACCOUNT block (the connect card
 * at the top until payouts are set up, the bank account at the floor of the
 * Earned half after). Removed: "Last payout · $X on date" (the payouts list
 * states every payout), the Spent card (now SpentSection.test.tsx), and
 * "Next expected" (owner 2026-10-25: a last-payout + 7 days guess that showed
 * a date already past). It reads nothing itself, so no Supabase call.
 */
// @mutate src/components/PaymentTab.tsx |       <section className="space-y-2 has-[>div:empty]:hidden"> |       <section className="space-y-2">
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";

// Payout setup OPEN here (the owner's switch-off of 2026-10-23 is the
// `payout_setup` switch); the switched-off state renders no card (below).
let paused = false;
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => paused }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, profile: null, loading: false }),
}));
let formRendersNothing = false;
vi.mock("@/components/PayoutSetupForm", () => ({
  PayoutSetupForm: ({ onSettled }: { onSettled?: () => void }) => {
    useEffect(() => { onSettled?.(); }, [onSettled]);
    return formRendersNothing ? null : <p>payout setup form</p>;
  },
}));
const from = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

import { PaymentTab } from "./PaymentTab";

function renderTab(onSettled?: () => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PaymentTab onSettled={onSettled} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PaymentTab, the Money tab's payout account (Q1177)", () => {
  it("states no 'Next expected', no 'Last payout', no Spent card and no range control", async () => {
    paused = false;
    formRendersNothing = false;
    renderTab();
    await screen.findByText("payout setup form");
    expect(screen.queryByText(/Next expected/)).toBeNull();
    expect(screen.queryByText(/Last payout/)).toBeNull();
    expect(screen.queryByText("Spent")).toBeNull();
    expect(screen.queryByText(/Total spent/)).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("reports settled once the setup form has", async () => {
    const onSettled = vi.fn();
    renderTab(onSettled);
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
  });

  it("the card's section is marked to hide when the form renders nothing", () => {
    paused = true;
    formRendersNothing = true;
    const { container } = renderTab();
    const card = container.querySelector(".liquid-glass");
    expect(card?.childElementCount).toBe(0);
    expect(card?.parentElement?.className).toMatch(/has-\[>div:empty\]:hidden/);
  });
});
