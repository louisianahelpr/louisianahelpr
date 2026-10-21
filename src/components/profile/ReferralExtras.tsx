// Referral-tab extras: how far the member is toward the referral ceiling.
//
// ONE progress, and it is money (spec v2 rebuild, audit 2026-10-21). This was
// a five-rung "rank" ladder that cleared a rung per person who SIGNED UP with
// the code, a rust bar for the same count, and a second bar for "N more to
// reach Friend 3" — so a member with 2 sign-ups and $0 earned saw two rungs
// "cleared" with "+$5" on each, beside "$0 from referrals". Sign-ups earn
// nothing until the friend's first job is done (check_referral_bonus), so the
// only true progress is the credit actually earned toward the $25 ceiling that
// enforce_referral_cap holds (see ReferralSection's headline note on why the
// ceiling is stated in dollars, not friends). Sign-ups are stated as what they
// are, beside it.

import { formatPriceExact } from "@/lib/format";

interface ReferralExtrasProps {
  /** People YOU referred (`referrals.referrer_id`). */
  referralCount: number;
  /**
   * Credit earned by referring people — referrer_bonus + subscription_bonus,
   * redeemed or not. NOT every credit row: a first_job_bonus you received as
   * the person referred is not progress here (VN-45), and ReferralSection
   * lists it separately. See src/lib/referralEarnings.ts.
   */
  earnedFromReferrals: number;
}

/** The dollar ceiling enforce_referral_cap holds (five $5 credits). */
const REFERRAL_CEILING = 25;

export function ReferralExtras({ referralCount, earnedFromReferrals }: ReferralExtrasProps) {
  const pct = Math.min(100, Math.round((Math.max(0, earnedFromReferrals) / REFERRAL_CEILING) * 100));
  return (
    <div className="rounded-[20px] liquid-glass p-card space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        {/* h2: the page h1 is "Referrals" (ProfileTabHeader). */}
        <h2 className="font-sans font-bold leading-tight text-ds-16 text-foreground">Referral rewards</h2>
        <div className="text-right shrink-0">
          <p className="font-sans font-bold tabular-nums leading-none text-ds-16" style={{ color: "hsl(var(--accent-ink))" }}>
            {/* formatPriceExact: credits are money the member can withdraw;
                never round them for display. */}
            ${formatPriceExact(earnedFromReferrals)}
          </p>
          <p className="font-sans text-ds-12 text-muted-foreground">from referrals</p>
        </div>
      </div>
      <div
        role="progressbar"
        aria-label="Referral credit earned toward the $25 limit"
        aria-valuemin={0}
        aria-valuemax={REFERRAL_CEILING}
        aria-valuenow={Math.min(REFERRAL_CEILING, Math.max(0, earnedFromReferrals))}
        className="h-1.5 rounded-full bg-muted overflow-hidden"
      >
        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="font-sans text-ds-13 text-muted-foreground leading-snug">
        {pct < 100 && `$${formatPriceExact(earnedFromReferrals)} of $25 earned. `}
        {referralCount === 1 ? "1 friend has" : `${referralCount} friends have`} signed up with your code; you earn when their first job is done.
      </p>
    </div>
  );
}
