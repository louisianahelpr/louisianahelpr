/**
 * CLASS GUARD: a first free Declutter claim (owner 2026-10-30): the claimer pays the one-time fee FIRST, then verifies,
 * once ever, and is told plainly why on one short screen. Behaviour of the server is proven by
 * src/test/pglite/freeClaimFeeThenId.pglite.mjs (the migration 3x; red with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261031003100_free_claim_fee_then_id.sql |   -- Owner 2026-10-30: a first claim pays the one-time fee first, then verifies. Off while identity_check is off.\n  PERFORM public.declutter_free_claim_gate(v_uid); |
 * @mutate src/lib/declutter/api.ts |   else if (freeClaimFeeRefusal(err)) openFreeClaimFirstTime(); |
 * @mutate src/components/identity/FreeClaimFirstTime.tsx |             A claim shares a real person's address, so we check ID once to keep members safe. |             Verify your ID.
 * @mutate src/components/identity/IdentityCheckSheet.tsx |     <FreeClaimFirstTime />\n |
 * @mutate supabase/functions/pay-onboarding-fee/index.ts | ? buildRedirectUrl("/declutter?verify_id=1&verify_reason=claim", isNative) | ? buildRedirectUrl("/declutter", isNative)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { blankComments, blankSqlComments } from "./helpers/blankNonCode";
import { newestFunction } from "./helpers/parityReaders";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    rpc: async () => ({ data: [{ onboarding_fee_cents: 200 }], error: null }),
  },
}));
vi.mock("@/hooks/useOnboardingFee", () => ({ useOnboardingFeeCents: () => 200, formatFeeLabel: (c: number | null) => (c === 200 ? "$2" : "") }));
vi.mock("@/lib/openExternalUrl", () => ({ openExternalUrl: vi.fn(async () => {}) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock("@/lib/errorLogger", () => ({ report: vi.fn() }));

import { FreeClaimFirstTime } from "@/components/identity/FreeClaimFirstTime";
import { closeFreeClaimFirstTime, freeClaimFeeRefusal, freeClaimGateRefusal, openFreeClaimFirstTime } from "@/lib/declutter/setupFee";
import { identityRefusal } from "@/lib/identityCheck";
import { DECLUTTER_ERROR_COPY } from "@/lib/declutter/errors";

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FreeClaimFirstTime />
    </QueryClientProvider>,
  );
}

describe("a first free claim", () => {
  beforeEach(() => invoke.mockReset());
  afterEach(() => { cleanup(); closeFreeClaimFirstTime(); });

  it("draws nothing until the server refuses", () => {
    show();
    expect(screen.queryByText(/real person's address/)).toBeNull();
  });

  it("the one short screen says why, plainly: an address, a one-time check, $2, never again, the item stays free", () => {
    show();
    act(() => openFreeClaimFirstTime());
    const text = document.querySelector("[data-free-claim-first-time]")?.textContent ?? "";
    expect(text).toMatch(/shares a real person's address/);
    expect(text).toMatch(/check ID once to keep members safe/);
    expect(text).toMatch(/\$2 covers the check/);
    expect(text).toMatch(/You pay it first, then verify/);
    expect(text).toMatch(/never be asked again/);
    expect(text).toMatch(/the item stays free/);
    expect(text).not.toMatch(/claude/i);
    // One short screen, not a page of terms.
    expect(text.length).toBeLessThan(260);
  });

  it("Pay opens the fee page and comes back to the ID check", async () => {
    invoke.mockResolvedValue({ data: { url: "https://checkout.stripe.test/fee" }, error: null });
    show();
    act(() => openFreeClaimFirstTime());
    fireEvent.click(screen.getByRole("button", { name: "Pay $2" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(invoke.mock.calls[0][0]).toBe("pay-onboarding-fee");
    expect(invoke.mock.calls[0][1].body.return_to).toBe("declutter_free_claim");
    expect(read("supabase/functions/pay-onboarding-fee/index.ts")).toContain('buildRedirectUrl("/declutter?verify_id=1&verify_reason=claim", isNative)');
  });

  it("the two refusals are told apart, and each is read by name", () => {
    expect(freeClaimFeeRefusal(new Error("setup_fee_required_to_claim"))).toBe(true);
    expect(freeClaimFeeRefusal(new Error("setup_fee_required_to_list"))).toBe(false);
    expect(freeClaimGateRefusal(new Error("identity_required_to_claim"))).toBe(true);
    expect(freeClaimGateRefusal(new Error("free_paused"))).toBe(false);
    expect(identityRefusal(new Error("identity_required_to_claim"))).toBe("claim");
    expect(DECLUTTER_ERROR_COPY.setup_fee_required_to_claim).toMatch(/stays free/);
    expect(DECLUTTER_ERROR_COPY.identity_required_to_claim).toMatch(/once/);
  });

  it("the server asks at both doors, the fee before the ID, and only with the switch on", () => {
    const gate = blankSqlComments(newestFunction("declutter_free_claim_gate").body);
    expect(gate).toMatch(/public\.identity_check_exempt\(p_member\)/);
    expect(gate.indexOf("setup_fee_required_to_claim")).toBeGreaterThan(0);
    expect(gate.indexOf("setup_fee_required_to_claim")).toBeLessThan(gate.indexOf("identity_required_to_claim"));
    for (const fn of ["declutter_request_free", "declutter_checkout_free"]) {
      expect(blankSqlComments(newestFunction(fn).body), fn).toMatch(/PERFORM public\.declutter_free_claim_gate\(v_uid\)/);
    }
  });

  it("the screen is mounted in the one host, behind the switch", () => {
    const sheet = blankComments(read("src/components/identity/IdentityCheckSheet.tsx"));
    expect(sheet.indexOf("if (!idOn) return null;")).toBeLessThan(sheet.indexOf("<FreeClaimFirstTime />"));
  });

  it("the words on the check itself never call it free", () => {
    expect(blankComments(read("src/components/identity/IdentityCheckSheet.tsx"))).not.toMatch(/\bfree\b(?! claim)/i);
  });
});
