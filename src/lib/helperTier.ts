/**
 * Helper verification ladder (#112).
 *
 * Today helprs have a single binary verification state ("Verified" or not).
 * That flattens a real spectrum — a Stripe-onboarded but zero-job helpr
 * looks identical to one with 30 5-star jobs. This computes a four-step
 * ladder (0 / 1 Verified / 2 Trusted / 3 Top Rated) from data we already have:
 *
 *   - `profiles.approval_status`         — admin/IDV approval
 *   - `profiles.stripe_identity_verified` — Stripe Connect's identity verdict
 *   - `profiles.stripe_account_id`   — Stripe Connect onboarding
 *   - completed-job count + avg rating from existing per-helpr stats
 *
 * No new tables or RPCs — every consumer (UserProfile, EarningsTab) already
 * loads these fields.
 *
 * Thresholds are intentionally adjacent-but-not-identical to the existing
 * achievement badges in `HelperBadges.tsx` (Elite / Top Rated / Trusted),
 * because the verification ladder answers a different question: "how
 * trusted is this person's account?" rather than "how decorated is their
 * track record?". A helpr with 5 perfect jobs but no Stripe will not reach
 * Tier 1 — Stripe Connect is the bedrock signal that money can actually
 * flow.
 */

export type HelperTier = 0 | 1 | 2 | 3;

/**
 * Minimal helpr-profile shape the ladder reads from. A `Profiles.Row`
 * satisfies this; tests can build a plain object literal.
 */
export interface HelperTierProfile {
  approval_status?: string | null;
  /**
   * Stripe Connect's identity verdict, cached by the `account.updated`
   * webhook. This replaced `idv_status` as the Tier-1 gate: `idv_status` is
   * flipped by the ID-upload flow and by an admin manual-approve that nobody
   * actually performs, so the publicly-rendered "Verified" rung asserted a
   * human ID review that never happened. See
   * supabase/functions/_shared/stripeIdentity.ts.
   */
  stripe_identity_verified?: boolean | null;
  stripe_account_id?: string | null;
}

export interface HelperTierStats {
  /** Distinct jobs where this user was the `helper_id` and status='completed'. */
  completedJobs: number;
  /** Mean rating across reviews where `reviewee_id` = this user. 0 if none. */
  avgRating: number;
  /** Total reviews counted in `avgRating`. */
  reviewCount: number;
}

// Thresholds are exported so the component can render "X more to reach …"
// hints without duplicating constants. The `elite` KEY is the ladder's
// internal identifier and is deliberately left alone — only the rung's
// user-facing LABEL was renamed to "Top Rated" (the word "Elite" now
// belongs solely to the paid membership tier).
export const TIER_THRESHOLDS = {
  trusted: { completedJobs: 5, avgRating: 4.5, reviewCount: 3 },
  elite: { completedJobs: 25, avgRating: 4.8, reviewCount: 10 },
} as const;

const isTier1Verified = (profile: HelperTierProfile): boolean => {
  if (profile.approval_status !== "approved") return false;
  if (profile.stripe_identity_verified !== true) return false;
  // Stripe Connect onboarding: presence of an account id is the project's
  // existing signal (see EarningsTab + ProfileLanding). Live payouts
  // status is fetched per-render from /stripe APIs and isn't needed for
  // the trust ladder — onboarding having been started is the gate.
  if (!profile.stripe_account_id) return false;
  return true;
};

/**
 * Compute the helpr's verification tier. Pure function — every threshold
 * comparison is total, so a missing/falsy field never throws.
 */
export function computeHelperTier(
  profile: HelperTierProfile | null | undefined,
  stats: HelperTierStats | null | undefined,
): HelperTier {
  if (!profile) return 0;
  if (!isTier1Verified(profile)) return 0;

  const c = Math.max(0, Math.floor(stats?.completedJobs ?? 0));
  const r = Math.max(0, stats?.avgRating ?? 0);
  const n = Math.max(0, Math.floor(stats?.reviewCount ?? 0));

  if (
    c >= TIER_THRESHOLDS.elite.completedJobs &&
    r >= TIER_THRESHOLDS.elite.avgRating &&
    n >= TIER_THRESHOLDS.elite.reviewCount
  ) {
    return 3;
  }
  if (
    c >= TIER_THRESHOLDS.trusted.completedJobs &&
    r >= TIER_THRESHOLDS.trusted.avgRating &&
    n >= TIER_THRESHOLDS.trusted.reviewCount
  ) {
    return 2;
  }
  return 1;
}

export interface TierProgressHint {
  /** The tier the helpr is currently *aiming* for (current + 1, or null at top). */
  nextTier: HelperTier | null;
  /** Short, customer-friendly bullets describing what's missing for `nextTier`. */
  missing: string[];
}

/**
 * What the helpr still needs to do to climb one rung. Returns
 * `nextTier: null` when they're already at Tier 3 (top of the ladder).
 * The strings are written for the helpr's own EarningsTab, but are short
 * enough to reuse in customer-facing tooltips ("3 more 5-star jobs to
 * reach Top Rated").
 */
export function describeTierProgress(
  current: HelperTier,
  profile: HelperTierProfile | null | undefined,
  stats: HelperTierStats | null | undefined,
): TierProgressHint {
  const c = Math.max(0, Math.floor(stats?.completedJobs ?? 0));
  const r = Math.max(0, stats?.avgRating ?? 0);
  const n = Math.max(0, Math.floor(stats?.reviewCount ?? 0));

  if (current === 0) {
    // Climbing onto the ladder — list the missing onboarding signals.
    const missing: string[] = [];
    if (profile?.approval_status !== "approved") missing.push("Finish account approval");
    if (profile?.stripe_identity_verified !== true) missing.push("Finish Stripe identity verification");
    if (!profile?.stripe_account_id) missing.push("Connect Stripe for payouts");
    return { nextTier: 1, missing };
  }

  if (current === 1) {
    const missing: string[] = [];
    const t = TIER_THRESHOLDS.trusted;
    if (c < t.completedJobs) {
      const gap = t.completedJobs - c;
      missing.push(`${gap} more completed job${gap === 1 ? "" : "s"}`);
    }
    if (n < t.reviewCount) {
      const gap = t.reviewCount - n;
      missing.push(`${gap} more review${gap === 1 ? "" : "s"}`);
    }
    if (r < t.avgRating) {
      missing.push(`Lift your average rating to ${t.avgRating.toFixed(1)}+`);
    }
    return { nextTier: 2, missing };
  }

  if (current === 2) {
    const missing: string[] = [];
    const t = TIER_THRESHOLDS.elite;
    if (c < t.completedJobs) {
      const gap = t.completedJobs - c;
      missing.push(`${gap} more completed job${gap === 1 ? "" : "s"}`);
    }
    if (n < t.reviewCount) {
      const gap = t.reviewCount - n;
      missing.push(`${gap} more review${gap === 1 ? "" : "s"}`);
    }
    if (r < t.avgRating) {
      missing.push(`Lift your average rating to ${t.avgRating.toFixed(1)}+`);
    }
    return { nextTier: 3, missing };
  }

  return { nextTier: null, missing: [] };
}
