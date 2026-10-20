/**
 * Home's money tiles show a number or nothing (spec v2 §1.5, §5.3): no tile
 * while a read is loading, when it FAILED (a failed read is not $0), at $0,
 * and no "Coming to you" until the one-time setup fee is known (else the
 * figure flashes $2 too high). The data hooks are stubbed here; the money
 * rules themselves are proven on real rows in homeMoneyTiles.test.tsx.
 *
 * @mutate src/pages/home/homeDashboard/homeMoney.ts |   if (profile && feeKnown && earnings.data && !earnings.isError) { |   if (profile && earnings.data) {
 * @mutate src/pages/home/homeDashboard/homeMoney.ts |   if (spend.data && !spend.isError) { |   if (spend.data) {
 * @mutate src/pages/home/homeDashboard/homeMoney.ts |     if (h.cents > 0) held = h; |     held = h;
 * @mutate src/pages/home/homeDashboard/homeMoney.ts |     if (c.cents > 0) coming = { |     coming = {
 * @mutate src/hooks/useFirstPayoutFee.ts |   return profile.onboarding_fee_paid === true \|\| fee.isSuccess; |   return profile.onboarding_fee_paid === true \|\| !fee.isPending;
 * @mutate src/hooks/useOnboardingFee.ts |       const data = unwrap(res); |       const data = res.error ? null : res.data;
 * @mutate src/pages/home/homeDashboard/homeMoney.ts | hasPayoutAccount: !!profile.stripe_account_id | hasPayoutAccount: true
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const state = vi.hoisted(() => ({
  profile: { subscription_tier: "free", subscription_expires_at: null, onboarding_fee_paid: true } as Record<string, unknown> | null,
  earnings: { data: undefined as unknown, isError: false },
  spend: { data: undefined as unknown, isError: false },
  feePending: false,
  feeFailed: false,
}));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u" }, profile: state.profile }) }));
vi.mock("@/hooks/useProfileTabData", () => ({ useProfileEarnings: () => state.earnings }));
vi.mock("@/components/profile/earningsTab/usePosterSpendData", () => ({ usePosterSpendData: () => state.spend }));
vi.mock("@/hooks/useOnboardingFee", () => ({
  useOnboardingFeeCents: () => (state.feePending || state.feeFailed ? null : 200),
  useOnboardingFeeQuery: () => ({
    isPending: state.feePending,
    isSuccess: !state.feePending && !state.feeFailed,
    isError: state.feeFailed,
    data: state.feePending || state.feeFailed ? undefined : 200,
  }),
}));

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { useHomeMoney } from "@/pages/home/homeDashboard/homeMoney";
import type { User } from "@supabase/supabase-js";

const user = { id: "u" } as User;
const approved = { id: "a", status: "completed", payment_status: "payout_pending", budget: 50, payout_scheduled_at: "2026-10-23T15:00:00Z" };
const hired = { id: "p", status: "accepted", payment_status: "escrow", stripe_payment_intent_id: "pi", budget: 40, customer_fee_amount: 1.5 };
const spendOf = (jobs: unknown[]) => ({ jobs, refunds: [], gifts: [], tips: [], blockFees: [] });

beforeEach(() => {
  state.profile = { subscription_tier: "free", subscription_expires_at: null, onboarding_fee_paid: true, stripe_account_id: "acct_x" };
  state.earnings = { data: { jobs: [approved], tips: [] }, isError: false };
  state.spend = { data: spendOf([hired]), isError: false };
  state.feePending = false;
  state.feeFailed = false;
});

describe("Home money tiles: a real number or no tile", () => {
  it("both reads in: both tiles", () => {
    const m = renderHook(() => useHomeMoney(user)).result.current;
    expect(m.coming?.cents).toBeGreaterThan(0);
    expect(m.coming?.at).toBe("2026-10-23T15:00:00Z");
    expect(m.held).toEqual({ cents: 4150, jobs: 1 });
  });

  it("loading: no tiles", () => {
    state.earnings = { data: undefined, isError: false };
    state.spend = { data: undefined, isError: false };
    expect(renderHook(() => useHomeMoney(user)).result.current).toEqual({ coming: null, held: null });
  });

  it("a failed read (even with old data cached) is not $0 and not a stale figure: no tile", () => {
    state.earnings = { data: { jobs: [approved], tips: [] }, isError: true };
    state.spend = { data: spendOf([hired]), isError: true };
    expect(renderHook(() => useHomeMoney(user)).result.current).toEqual({ coming: null, held: null });
  });

  it("$0: no tile", () => {
    state.earnings = { data: { jobs: [{ ...approved, payment_status: "released" }], tips: [] }, isError: false };
    state.spend = { data: spendOf([{ ...hired, status: "open" }]), isError: false };
    expect(renderHook(() => useHomeMoney(user)).result.current).toEqual({ coming: null, held: null });
  });

  it("setup fee still owed and its amount not loaded yet: no Coming to you (it would read $2 high)", () => {
    state.profile = { subscription_tier: "free", subscription_expires_at: null, onboarding_fee_paid: false, stripe_account_id: "acct_x" };
    state.feePending = true;
    expect(renderHook(() => useHomeMoney(user)).result.current.coming).toBeNull();
    state.feePending = false;
    // Known now: the fee comes off once ($44 - $2).
    expect(renderHook(() => useHomeMoney(user)).result.current.coming?.cents).toBe(4200);
  });

  it("the setup-fee read FAILED: not an answer, so still no Coming to you (lh-money-escrow, 2026-10-20)", () => {
    state.profile = { subscription_tier: "free", subscription_expires_at: null, onboarding_fee_paid: false, stripe_account_id: "acct_x" };
    state.feeFailed = true;
    expect(renderHook(() => useHomeMoney(user)).result.current.coming).toBeNull();
  });

  it("the fee read THROWS on failure, so a failed read is isError, never a success with no fee", () => {
    const feeSrc = blankComments(readFileSync(resolve(__dirname, "../hooks/useOnboardingFee.ts"), "utf8"));
    expect(feeSrc).toMatch(/export function useOnboardingFeeQuery\(\)/);
    expect(feeSrc).toMatch(/const res = await supabase\.rpc\("get_public_platform_settings"\);\s*if \(res\.error\) report\([^;]*\);\s*const data = unwrap\(res\);/);
  });

  it("no payout account: the tile knows, so it never names a wallet date", () => {
    state.profile = { subscription_tier: "free", subscription_expires_at: null, onboarding_fee_paid: true, stripe_account_id: null };
    expect(renderHook(() => useHomeMoney(user)).result.current.coming?.hasPayoutAccount).toBe(false);
  });
});
