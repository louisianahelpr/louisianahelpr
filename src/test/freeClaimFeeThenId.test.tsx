/**
 * CLASS GUARD: a first free Declutter claim (owner 2026-10-30): asking is free. Once the giver picks them, a first-timer
 * pays the one-time fee FIRST, then verifies, once ever, and is told plainly why on one short screen. If they don't
 * complete it the giver can pick someone else. Behaviour of the server is proven by
 * src/test/pglite/freeClaimFeeThenId.pglite.mjs (the migration 3x; red with NEW_MIGRATION=skip).
 *
 * @mutate supabase/migrations/20261031003100_free_claim_fee_then_id.sql |   PERFORM public.declutter_free_claim_gate(v_uid);\n  IF p_handover = 'porch' AND EXISTS ( |   IF p_handover = 'porch' AND EXISTS (
 * @mutate supabase/migrations/20261031003100_free_claim_fee_then_id.sql |  WHERE q.item_id = NEW.id AND q.status = 'not_picked' |  WHERE q.item_id = NEW.id AND q.status = 'never'
 * @mutate src/lib/declutter/api.ts |   else if (freeClaimFeeRefusal(err)) openFreeClaimFirstTime(); |
 * @mutate src/components/identity/FreeClaimFirstTime.tsx |             A claim shares a real person's address, so we check ID once to keep members safe. |             Verify your ID.
 * @mutate src/components/identity/IdentityCheckSheet.tsx |     <FreeClaimFirstTime />\n |
 * @mutate supabase/functions/pay-onboarding-fee/index.ts | ? buildRedirectUrl("/declutter?tab=buying&verify_id=1&verify_reason=claim", isNative) | ? buildRedirectUrl("/declutter?tab=buying", isNative)
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
const feeCents = vi.hoisted(() => ({ value: 200 as number | null }));
vi.mock("@/hooks/useOnboardingFee", () => ({ useOnboardingFeeCents: () => feeCents.value, formatFeeLabel: (c: number | null) => (c === 200 ? "$2" : "") }));
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
    expect(read("supabase/functions/pay-onboarding-fee/index.ts")).toContain('buildRedirectUrl("/declutter?tab=buying&verify_id=1&verify_reason=claim", isNative)');
  });

  // @mutate src/components/identity/FreeClaimFirstTime.tsx | feeLabel ? `Pay ${feeLabel}` : "Continue to payment" | `Pay ${feeLabel}`
  it("a fee amount that could not be read: sensible words, never \"Pay The fee\"", async () => {
    feeCents.value = null;
    try {
      show();
      act(() => openFreeClaimFirstTime());
      expect(await screen.findByRole("button", { name: "Continue to payment" })).toBeTruthy();
      expect(screen.getByText(/A one-time fee covers the check\./)).toBeTruthy();
      expect(screen.queryByText(/Pay The fee/)).toBeNull();
    } finally {
      feeCents.value = 200;
    }
  });

  // @mutate src/components/identity/IdentityCheckSheet.tsx | checks a photo ID and a selfie.",\n  general: | checks a photo ID and a selfie. Once, and never again.",\n  general:
  it("the ID sheet says \"once\" one time: the shared line does, so the claim's lead does not", () => {
    const sheet = blankComments(read("src/components/identity/IdentityCheckSheet.tsx"));
    expect(sheet).toMatch(/you only do it once/);
    expect(sheet).not.toMatch(/Once, and never again/);
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

  it("asking is free; the server asks at the free checkout, the fee before the ID, and only with the switch on", () => {
    const gate = blankSqlComments(newestFunction("declutter_free_claim_gate").body);
    expect(gate).toMatch(/public\.identity_check_exempt\(p_member\)/);
    expect(gate.indexOf("setup_fee_required_to_claim")).toBeGreaterThan(0);
    expect(gate.indexOf("setup_fee_required_to_claim")).toBeLessThan(gate.indexOf("identity_required_to_claim"));
    expect(blankSqlComments(newestFunction("declutter_checkout_free").body)).toMatch(/PERFORM public\.declutter_free_claim_gate\(v_uid\)/);
    expect(blankSqlComments(newestFunction("declutter_request_free").body)).not.toMatch(/declutter_free_claim_gate/);
  });

  it("the screen is mounted in the one host, behind the switch", () => {
    const sheet = blankComments(read("src/components/identity/IdentityCheckSheet.tsx"));
    expect(sheet.indexOf("if (!idOn) return null;")).toBeLessThan(sheet.indexOf("<FreeClaimFirstTime />"));
  });

  it("the words on the check itself never call it free", () => {
    expect(blankComments(read("src/components/identity/IdentityCheckSheet.tsx"))).not.toMatch(/\bfree\b(?! claim)/i);
  });
});
