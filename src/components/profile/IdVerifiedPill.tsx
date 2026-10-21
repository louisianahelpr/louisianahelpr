import { Landmark, ShieldCheck } from "lucide-react";
import type { CSSProperties } from "react";

/**
 * ID VERIFICATION HAS ONE FORM: a gold pill with a shield.
 *
 * It used to have four, all on screens a reader meets minutes apart (owner,
 * 2026-09-11 — "make it one"):
 *
 *   (a) the gold "Stripe verified" pill + shield in the profile badge row
 *       (`userProfile/RecognitionRow.tsx`),
 *   (b) an "As a Helpr" ladder rung literally labelled "Verified" — the same
 *       claim as (a), one line below it, in a different colour. Deleted
 *       outright ("not needed it clerly mentions this above"),
 *   (c) a bark disc with a white shield stamped on the corner of the profile
 *       header's avatar, labelled "ID verified by Stripe". Deleted — it was
 *       the same fact as (a), 40px above it, and it decorated the PICTURE
 *       rather than stating something about the person,
 *   (d) "✓ ID VERIFIED" — uppercase, letterspaced, no pill, a literal ✓
 *       character — on the "Posted by" tile (`dashboard/JobPosterCard.tsx`,
 *       via `TrustRow`).
 *
 * (a) is the form that survives, and this module is where it lives so the
 * next surface that needs it imports the treatment instead of inventing a
 * fifth. The copy lives here too: one claim, one wording.
 */

/** The pill's own surface. Shared with the `ProfileBadge` form in the badge row. */
export const ID_VERIFIED_PILL_STYLE: CSSProperties = {
  background: "hsl(var(--gold-warm) / 0.14)",
  border: "0.5px solid hsl(var(--gold-warm) / 0.36)",
  color: "hsl(var(--gold-ink))",
};

/**
 * Owner, 2026-10-21 (pop-up, Q2201; supersedes the 2026-10-08 "only Stripe ID
 * verified" pin): ONE neutral "ID verified" whichever route verified the ID,
 * Stripe Identity or an admin's hand approval. Only admins see the route
 * (adminUserHelpers: "ID verified by Stripe" / "ID verified by admin").
 */
export const ID_VERIFIED_LABEL = "ID verified";

export const ID_VERIFIED_DESCRIPTION =
  "A government ID was checked and matched this member. Earned by completing ID verification in Profile.";

/**
 * "Payouts set up" (owner, 2026-10-21): Stripe Connect payout setup is done
 * (`profiles.stripe_payouts_enabled`, published as get_safe_profiles.is_payout_ready).
 * A separate fact from "ID verified" (Stripe Identity), with its own badge, so
 * payout setup never reads as an ID check.
 */
export const PAYOUTS_SET_UP_LABEL = "Payouts set up";

export const PAYOUTS_SET_UP_DESCRIPTION =
  "This member set up payouts with Stripe, which checked their payment details.";

export const PAYOUTS_SET_UP_PILL_STYLE: CSSProperties = {
  background: "hsl(var(--sage) / 0.16)",
  border: "0.5px solid hsl(var(--sage) / 0.4)",
  color: "hsl(var(--success-ink))",
};

export const PayoutsSetUpIcon = ({ className }: { className?: string }) => (
  <Landmark className={className} strokeWidth={2.25} aria-hidden />
);

/** The shield, at the one size and weight every surface draws it. */
export const IdVerifiedShield = ({ className }: { className?: string }) => (
  <ShieldCheck
    className={className}
    strokeWidth={2.5}
    style={{ color: "hsl(var(--gold-warm))" }}
    aria-hidden
  />
);
