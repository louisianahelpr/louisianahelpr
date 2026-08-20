/**
 * Master kill switch for the Business product (team seats, roster, billing,
 * exports, onboarding, and the /for-business marketing page).
 *
 * Turned OFF 2026-08-20 at the owner's request: "Hide all business references
 * etc. don't show any of it — I will decide later."
 *
 * Nothing is deleted. The pages, components, hooks, RPCs, RLS policies and the
 * `businesses` / `business_members` tables all remain, so flipping this back to
 * `true` restores the feature. This mirrors the existing `BGC_PURCHASE_ENABLED`
 * and `RECURRING_ENABLED` switches.
 *
 * WHY IT WAS SWITCHED OFF — two bugs made it unusable, both found on device:
 *
 *   1. The only entry point was gated on `profiles.subscription_tier ===
 *      "business"` rather than on actually owning a business. A business owner
 *      on any other tier — which is every owner before they buy a seat plan —
 *      had no route into their own workspace at all.
 *
 *   2. `useMyBusiness` selects the caller's active membership with
 *      `.maybeSingle()`, which ERRORS on more than one row. A user who belongs
 *      to two businesses (own one, invited to a client's — nothing prevents it)
 *      got that error swallowed into `null`, and the app told an active owner
 *      of two businesses "You're not part of a business."
 *
 * BEFORE RE-ENABLING: fix both. Gate on membership, not tier; and decide the
 * product rule for multiple memberships (a switcher, or a DB constraint) rather
 * than silently returning null.
 */
export const BUSINESS_ENABLED = false;
