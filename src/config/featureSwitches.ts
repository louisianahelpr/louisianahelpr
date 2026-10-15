/**
 * Hidden feature switches: the client's copy of the registry.
 *
 * A new feature ships to the real app behind a switch that is on only for the
 * owner (admin role) and the test accounts, then is flipped on for everyone in
 * Admin -> Settings (owner decision, 2026-10-11). The registry itself is
 * `public.feature_switches` (migration 20261012031120); the server decides with
 * `public.feature_enabled_for(key)` and an RPC behind a hidden feature refuses
 * with `public.require_feature(key)`. How to add one: "How to ship a hidden
 * feature" in .claude/AGENT-BRIEF.md.
 *
 * This list is EXACT both ways (src/test/featureSwitchRegistry.test.ts): every
 * key here is created by a migration and read by a `useFeature("<key>")` call
 * in src, and every such call names a key here. A key nobody reads is a
 * leftover; a key no migration creates reads as OFF forever.
 */
export const FEATURE_SWITCH_KEYS = [
  // Gates no product feature. Admin -> Settings reads it to show the viewer
  // that hidden switches reach them; the nightly feature-switch-audience check
  // uses it as its positive control.
  "switch_canary",
  // Declutter (docs/specs/declutter-auctions.md): selling and buying used
  // household items. Created OFF by 20261014193955; every declutter_* RPC
  // refuses without it (require_feature).
  "declutter",
  // "Suggest a category" (owner decision I1, 2026-10-14): the button under every
  // category picker and the admin queue. Created 'testers' by 20261015051141;
  // suggest_category() and the admin RPCs refuse without it (require_feature).
  "suggest_category",
  // Roadmap F4 (owner 2026-10-14/15): membership purchases and every upgrade
  // entry point. Created at TESTERS by 20261015033658 (the App Review account
  // keeps Pro during the 1.0.4 review; every member is off); create-pro-checkout
  // and subscription_purchase_eligibility refuse anyone it is off for.
  "memberships",
  // Quotes on jobs (roadmap Q1-Q8, owner 2026-10-14): Get quotes on Post a Job,
  // the quote form and counters. Created OFF by 20261015091114; every job quote
  // RPC refuses without it (require_feature).
  "quotes",
] as const;

export type FeatureKey = (typeof FEATURE_SWITCH_KEYS)[number];

export type FeatureAudience = "off" | "testers" | "everyone";

export const FEATURE_AUDIENCES: readonly FeatureAudience[] = ["off", "testers", "everyone"];

export const FEATURE_AUDIENCE_LABEL: Record<FeatureAudience, string> = {
  off: "Off",
  testers: "Testers only",
  everyone: "Everyone",
};
