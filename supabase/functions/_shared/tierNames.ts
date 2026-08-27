// The ONE place a raw `profiles.subscription_tier` id becomes a name a human
// reads. The owner's 2026-08-24 naming rule is that the brand leads the tier
// name — "Helpr Basic / Helpr Pro / Helpr Elite" — everywhere it is displayed.
//
// WHY THIS LIVES IN `_shared` RATHER THAN NEXT TO TIER_PERKS. The display names
// are already stored in `TIER_PERKS[tier].name` (src/lib/subscriptionTiers.ts),
// but that module imports through the `@/lib/...` alias, so a Deno edge function
// cannot import it. Edge functions DO render tier names at a user — the
// expire-subscriptions "your pass ended" notification and the Helpr Pass wallet
// TIER field are both read by a person — and those used to hand-capitalize the
// raw id ("Your pro pass ended."). This file is the plain-TS source both
// runtimes can reach; `src/lib/subscriptionTiers.ts` re-exports it, and
// `src/lib/tierNames.parity.test.ts` asserts these strings and TIER_PERKS never
// drift apart. Mirrors the `_shared/proTiers.ts` + `src/lib/proTiers.ts` pattern.
//
// "Free" and "Business" deliberately carry NO prefix: Free is the absence of a
// Helpr plan, and Business is billed per-seat on the businessSeatTiers ladder,
// not as a consumer "Helpr <tier>" membership.

export const TIER_DISPLAY_NAMES: Record<string, string> = {
  free: "Free",
  basic: "Helpr Basic",
  pro: "Helpr Pro",
  elite: "Helpr Elite",
  business: "Business",
};

/**
 * Render a raw `subscription_tier` value as its user-facing name.
 *
 * Null / undefined / empty / unknown → "Free", matching `toSubscriptionTier`'s
 * safe default: an unrecognized id must never be printed back at the user raw
 * (the bug this replaces printed a bare, lowercase, un-branded id).
 * Case is normalized so a legacy "PRO" row still reads "Helpr Pro".
 */
export function tierDisplayName(raw: string | null | undefined): string {
  return TIER_DISPLAY_NAMES[(raw ?? "").toLowerCase()] ?? TIER_DISPLAY_NAMES.free;
}
