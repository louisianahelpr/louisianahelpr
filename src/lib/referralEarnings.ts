// referralEarnings — one definition of "where did my referral credit come from".
//
// VN-45 (owner, 2026-09-14): the Referrals page said "$15 earned / $15 to cash
// out" beside "0 referrals" and an empty rank ladder. Both were true, and read
// as a bug, because they answered different questions from different tables:
//
//   • the money tiles summed EVERY `referral_credits` row for the user,
//   • "Referrals" and the ladder counted `referrals` rows where YOU are the
//     referrer.
//
// A `first_job_bonus` is paid to the person who WAS referred (check_referral_bonus
// mints $5 to both sides when the referee's first job completes), so a user who
// joined through a friend's code holds $5 of credit with zero referrals of their
// own. Admin or test rows land in the same table under other reasons.
//
// The fix is display only. Money stays the credit ledger, because that is what
// `cash-out-credits` pays out (every unredeemed row for the user, any reason):
// "Total earned" and "To cash out" are still those totals. What changes is that
// the page now says which part of the total came from referring people, which
// part came from being referred, and which part is neither — and the ladder,
// which is about people you referred, shows only the first part.

export interface ReferralCreditRow {
  amount: number | string;
  reason: string | null;
  redeemed: boolean;
}

/** Reasons minted for the REFERRER: the $5 first-job half and the $10 upgrade bonus. */
export const FROM_REFERRING_REASONS: readonly string[] = ["referrer_bonus", "subscription_bonus"];
/** Reason minted for the person who WAS referred. */
export const FROM_BEING_REFERRED_REASONS: readonly string[] = ["first_job_bonus"];

export type ReferralEarningsSource = "fromReferring" | "fromBeingReferred" | "other";

export const REFERRAL_EARNINGS_LABELS: Record<ReferralEarningsSource, string> = {
  fromReferring: "From your referrals",
  fromBeingReferred: "From being referred",
  other: "Other credits",
};

export interface ReferralEarningsBreakdown {
  /** Lifetime credit, redeemed + unredeemed — the "Total earned" tile. */
  total: number;
  /** What a cash-out would move right now — the "To cash out" tile. */
  unredeemed: number;
  fromReferring: number;
  fromBeingReferred: number;
  /** Any other reason (admin grants, legacy or test rows). Unknown never counts as a referral. */
  other: number;
  /**
   * True when part of `total` did not come from referring someone — the case
   * where the tiles and the ladder would otherwise disagree with no reason given.
   */
  needsExplanation: boolean;
  /** Non-zero sources in display order. */
  lines: Array<{ source: ReferralEarningsSource; label: string; amount: number }>;
}

/** Sum in cents so $0.10 + $0.20 never renders as $0.30000000000000004. */
const toCents = (amount: number | string) => {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function sourceOfReason(reason: string | null | undefined): ReferralEarningsSource {
  if (reason && FROM_REFERRING_REASONS.includes(reason)) return "fromReferring";
  if (reason && FROM_BEING_REFERRED_REASONS.includes(reason)) return "fromBeingReferred";
  return "other";
}

export function referralEarningsBreakdown(credits: readonly ReferralCreditRow[]): ReferralEarningsBreakdown {
  const cents: Record<ReferralEarningsSource, number> = { fromReferring: 0, fromBeingReferred: 0, other: 0 };
  let unredeemed = 0;
  for (const c of credits) {
    const amt = toCents(c.amount);
    cents[sourceOfReason(c.reason)] += amt;
    if (!c.redeemed) unredeemed += amt;
  }
  const total = cents.fromReferring + cents.fromBeingReferred + cents.other;
  const order: ReferralEarningsSource[] = ["fromReferring", "fromBeingReferred", "other"];
  return {
    total: total / 100,
    unredeemed: unredeemed / 100,
    fromReferring: cents.fromReferring / 100,
    fromBeingReferred: cents.fromBeingReferred / 100,
    other: cents.other / 100,
    needsExplanation: cents.fromBeingReferred > 0 || cents.other > 0,
    lines: order
      .filter((s) => cents[s] > 0)
      .map((s) => ({ source: s, label: REFERRAL_EARNINGS_LABELS[s], amount: cents[s] / 100 })),
  };
}
