/**
 * The line under "Confirm and pick a time" (Tester 11, 10-30). Owner 2026-11-20: a free claim never has an ID check or
 * a setup fee, so every member, first-timer or not, ID switch on or off, reads that nothing is charged (it told a
 * first-timer about "a one-time ID check next" from 10-30).
 *
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {t(trade ? TRADE_CHECKOUT_LINE : FREE_CHECKOUT_LINE)} | {t(trade ? TRADE_CHECKOUT_LINE : TRADE_CHECKOUT_LINE)}
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ paid: false as boolean | undefined, on: true }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => {
      const answer = Promise.resolve({ data: [], error: null });
      return Object.assign(answer, { abortSignal: () => answer });
    },
  },
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: { onboarding_fee_paid: h.paid } }) }));
vi.mock("@/lib/identityCheckSwitch", () => ({ useIdentityCheckOnStore: () => h.on }));
vi.mock("sonner", async () => (await import("@/test/helpers/sonnerMock")).sonnerMock());

import { FreeCheckoutForSeller } from "./DeclutterFreeClaim";

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FreeCheckoutForSeller sellerId="s1" porchOk onDone={() => undefined} />
    </QueryClientProvider>,
  );
}

describe("the free checkout's charge line", () => {
  afterEach(cleanup);

  it.each([
    ["a first-timer with the ID switch on", false, true],
    ["a member who already paid", true, true],
    ["a first-timer with the switch off", false, false],
  ])("%s reads that nothing is charged, with no ID or fee words", (_label, paid, on) => {
    h.paid = paid;
    h.on = on;
    show();
    expect(screen.getByText(/Nothing is charged\./)).toBeTruthy();
    expect(screen.queryByText(/ID check|setup fee/i)).toBeNull();
  });
});
