/**
 * The line under "Confirm and pick a time" (Tester 11, 10-30). A first-timer is one tap from the one-time fee there
 * (setup_fee_required_to_claim), so "Nothing is charged" was false for them. Same reading as the ask line.
 *
 * @mutate src/components/declutter/DeclutterFreeClaim.tsx | {oneTimeCheckAhead ? FREE_CHECKOUT_FIRST_LINE : FREE_CHECKOUT_LINE} | {FREE_CHECKOUT_LINE}
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
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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

  it("a first-timer with the check on is never told nothing is charged, and is told what comes next", () => {
    h.paid = false;
    h.on = true;
    show();
    expect(screen.queryByText(/nothing is charged/i)).toBeNull();
    expect(screen.getByText(/The item stays free\. Your first claim has a one-time ID check next, and we'll show you the cost first\./)).toBeTruthy();
  });

  it("a member who already paid still reads that nothing is charged", () => {
    h.paid = true;
    h.on = true;
    show();
    expect(screen.getByText(/Nothing is charged\./)).toBeTruthy();
  });

  it("with the switch off, nothing changes", () => {
    h.paid = false;
    h.on = false;
    show();
    expect(screen.getByText(/Nothing is charged\./)).toBeTruthy();
  });
});
