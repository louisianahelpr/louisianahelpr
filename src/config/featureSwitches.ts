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
  // Declutter moving-out mode (docs/specs/declutter-moving-out.md): list a
  // whole home from room photos, a moving-sale banner on the seller's profile.
  // Created 'testers' by 20261016053625; its RPCs and the room scan refuse
  // without it (and without 'declutter').
  "declutter_moving_out",
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
  // Declutter wanted posts (docs/specs/declutter-wanted-price-hint.md, W1):
  // created at TESTERS by 20261016053541; declutter_create_wanted /
  // _close_wanted / _my_wanted refuse without it AND 'declutter', and no wanted
  // alert reaches a member it is off for.
  "declutter_wanted",
  // Declutter fair-price hint ("Most similar items sold for $X-$Y near you",
  // W9-W12): created at TESTERS by 20261016053541; declutter_price_hint
  // refuses without it AND 'declutter'.
  "declutter_price_hint",
  // Shops slice 1 (docs/specs/local-shops-prep.md L90: ONE switch for the
  // whole Shops section): free shop / business profiles. Created OFF by
  // 20261017061155; every shops_* RPC refuses without it (require_feature).
  "shops",
  // Declutter haul-away (docs/specs/declutter-haul-away.md): book a Helpr job to
  // take unsold items to donation or the dump. Created 'testers' by
  // 20261017070827; its three RPCs refuse without it AND 'declutter'.
  "declutter_haul_away",
  // Declutter "Add a Helpr" (owner 2026-10-16; docs/specs/declutter-add-a-helpr.md):
  // after buying, one tap books a Helpr to assemble, wall-mount or set up the
  // item. Created 'testers' by 20261017073146; declutter_setup_helpr and
  // declutter_link_setup_job refuse without it (require_feature).
  "declutter_add_helpr",
  // Rentals S1 (docs/specs/landlord-hub-prep.md): landlords invite tenants,
  // tenants send maintenance requests that become Helpr jobs. Created OFF by
  // 20261017205605; every rentals_* RPC refuses without it (require_feature).
  "rentals",
  // Board 188, proof on applicants (builder2f 2026-10-21): each applicant's completed jobs in the job's
  // category, for the job's poster. Created 'testers' by 20261021020444; get_applicant_category_counts
  // refuses without it (require_feature).
  "applicant_proof",
  // Board 184, "Sent to N Helprs" (builder2f 2026-10-21): the new-job alerts already sent for the poster's
  // open job. Created 'testers' by 20261021020915; get_job_match_reach refuses without it (require_feature).
  "job_reach",
  // Board 190, price guidance (builder2f 2026-10-21): what most real completed jobs in a category paid, shown
  // only with 30+ jobs. Created 'testers' by 20261021054721; get_price_guidance refuses without it.
  "price_guidance",
  // Come-back emails (owner yes 2026-10-21): a note from the founder to a member
  // who signed up and never came back (about day 3, one more about day 10).
  // Created OFF by 20261021113827. No screen: SERVER_ONLY below.
  "come_back_emails",
  // Board 141, refund requests, Jobs side (owner 2026-10-21, Q2272): a poster asks the Helpr for part or all
  // of a held job's money back; the Helpr agrees (the money moves on its own), offers to come back and finish,
  // or says no (Helpr decides). Created 'testers' by 20261021102943; rpc_open_refund_request and
  // rpc_answer_refund_request refuse without it (require_feature).
  "refund_requests",
  // SMS text alerts (20261021193738): set_sms_consent refuses a new opt-in without it.
  "sms_alerts",
] as const;

/**
 * Switches with no screen: nothing in the app shows or hides anything for
 * them, so no useFeature() reads them. The server decides with
 * public.feature_enabled_for_user(key, member) per member (a cron that mails
 * members). Each is still in FEATURE_SWITCH_KEYS (the registry and Admin ->
 * Settings list it like any other). EXACT both ways in
 * src/test/featureSwitchRegistry.test.ts: a key here is never read by
 * useFeature and IS read by a migration's feature_enabled_for_user('<key>',
 * ...); every other key is read by useFeature.
 */
export const SERVER_ONLY_FEATURE_SWITCH_KEYS: readonly FeatureKey[] = ["come_back_emails"];

export type FeatureKey = (typeof FEATURE_SWITCH_KEYS)[number];

export type FeatureAudience = "off" | "testers" | "everyone";

export const FEATURE_AUDIENCES: readonly FeatureAudience[] = ["off", "testers", "everyone"];

export const FEATURE_AUDIENCE_LABEL: Record<FeatureAudience, string> = {
  off: "Off",
  testers: "Testers only",
  everyone: "Everyone",
};
