// firstPayoutFee — the ONE place a Helpr's take-home loses the one-time setup
// fee (ME-008, Q753). `release-payout` and `process-scheduled-payouts` take
// `platform_settings.onboarding_fee_cents` out of the FIRST payout of an
// account whose `profiles.onboarding_fee_paid` is not true, so every figure
// that previews a payout must come off by the same amount or it reads higher
// than what lands.
//
// Pure and synchronous, like helperEarnings.ts. The amount itself comes from
// `useFirstPayoutFeeCents` (src/hooks/useFirstPayoutFee.ts); surfaces pass it
// in as dollars. Guarded by src/test/firstPayoutFeeEverySurface.test.ts.

/**
 * A take-home after the one-time fee, UNROUNDED (callers floor for display).
 * Never negative: the server refuses a first payout that does not cover the fee
 * (`release-payout` 422), so the honest preview of such a job is $0, not a
 * negative number or the pre-fee figure. A zero or absent fee passes the figure
 * through untouched.
 */
export function netAfterFirstPayoutFee(netDollars: number, firstPayoutFeeDollars = 0): number {
  if (!(firstPayoutFeeDollars > 0)) return netDollars;
  return Math.max(0, netDollars - firstPayoutFeeDollars);
}

/**
 * Sum of take-homes where the fee comes off ONCE. The fee is collected from a
 * single payout, so a list of jobs must not subtract it per row: the first
 * row carries it and the rest are untouched, which is what the server does.
 */
export function sumAfterFirstPayoutFee(
  takeHomes: readonly number[],
  firstPayoutFeeDollars = 0,
): number {
  return takeHomes.reduce(
    (sum, n, i) => sum + (i === 0 ? netAfterFirstPayoutFee(n, firstPayoutFeeDollars) : n),
    0,
  );
}
