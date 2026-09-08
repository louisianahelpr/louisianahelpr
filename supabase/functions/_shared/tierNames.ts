// The ONE place a raw `profiles.subscription_tier` id becomes a name a human
// reads. Tiers are named by the tier alone — "Basic / Pro / Elite".
//
// This reversed an earlier rule (2026-08-24) that put the brand in front of
// every tier: inside the app the brand is already established by the app you
// are standing in, so "Helpr Elite" on a Helpr screen spent a word to say
// nothing. Owner's call, 2026-08-27. The centralisation is the durable part —
// whichever way the names read, they read that way in one file.
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
// There is no "Business" entry. It was removed on 2026-09-01 together with the
// `business` rung in `helperFees.ts` and the `business` row in TIER_PERKS —
// nothing can sell or store that tier (see the helperFees.ts header). A legacy
// 'business' string therefore falls through `tierDisplayName`'s default and
// reads back as "Free", the same safe default every other unknown id gets.
export const TIER_DISPLAY_NAMES: Record<string, string> = {
  free: "Free",
  basic: "Basic",
  pro: "Pro",
  // "Plus", never "Helpr Plus" — the no-brand-prefix ruling above applies to
  // every tier added after it, this one included.
  plus: "Plus",
  elite: "Elite",
};

/**
 * Render a raw `subscription_tier` value as its user-facing name.
 *
 * Null / undefined / empty / unknown → "Free", matching `toSubscriptionTier`'s
 * safe default: an unrecognized id must never be printed back at the user raw
 * (the bug this replaces printed a bare, lowercase, un-branded id).
 * Case is normalized so a legacy "PRO" row still reads "Pro".
 */
export function tierDisplayName(raw: string | null | undefined): string {
  return TIER_DISPLAY_NAMES[(raw ?? "").toLowerCase()] ?? TIER_DISPLAY_NAMES.free;
}
