import { ShieldCheck } from "lucide-react";
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

export const ID_VERIFIED_LABEL = "ID verified";

export const ID_VERIFIED_DESCRIPTION =
  "A government ID was checked by Stripe Identity and matched this member. Earned by completing ID verification in Profile.";

/** The shield, at the one size and weight every surface draws it. */
export const IdVerifiedShield = ({ className }: { className?: string }) => (
  <ShieldCheck
    className={className}
    strokeWidth={2.5}
    style={{ color: "hsl(var(--gold-warm))" }}
    aria-hidden
  />
);

/**
 * The standalone pill, for surfaces that are not the profile badge row (the
 * badge row draws the same treatment through `ProfileBadge`, which adds the
 * shared 44px tap target and the explanatory popover).
 */
export const IdVerifiedPill = ({ className }: { className?: string }) => (
  <span
    className={[
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
      "font-sans font-semibold text-ds-11 leading-none",
      className ?? "",
    ]
      .filter(Boolean)
      .join(" ")}
    style={ID_VERIFIED_PILL_STYLE}
  >
    <IdVerifiedShield className="w-3.5 h-3.5 shrink-0" />
    {ID_VERIFIED_LABEL}
  </span>
);
