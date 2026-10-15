import { Link } from "react-router-dom";

/*
 * The two static footnotes under the membership tier cards, moved out of
 * SubscriptionTab.tsx (componentSizeRatchet: that file is over the size
 * threshold and may only shrink). Rendering is unchanged.
 */

export function MembershipFeeNote() {
  return (
    <>
      {/* POSTING IS FREE OF PLATFORM FEES (owner, 2026-10-11). The tier
          sets only the cut on jobs you do; posting costs a service fee that
          covers card processing, on every tier. Stated once, in the place a
          reader looks for the catch, so nobody buys a tier expecting it to
          cut what they pay to post.

          Deliberately a single line rather than a fourth explainer box: the
          card list above is `flex-1 … justify-between`, so anything tall added
          here takes height from the cards. */}
      <p
        className="mt-3 text-center font-sans leading-snug text-ds-11"
        style={{ color: "hsl(var(--olivewood) / 0.85)" }}
      >
        <span className="font-sans font-bold" style={{ color: "hsl(var(--ink-deep))" }}>
          Posting has no platform fee.
        </span>{" "}
        Your tier sets the cut on what you earn. Posting a job costs only a service fee that covers card processing.
      </p>
    </>
  );
}

export function MembershipLegalLinks() {
  return (
    <>
      {/* Q1795 (App Store 3.1.2 / lh-compliance-store@c16b0f0dc#2): an app
          selling auto-renewing subscriptions must link its Terms of Use and
          Privacy Policy on the purchase surface itself. Shown everywhere: the
          same terms govern a membership bought on the web. */}
      <p className="mt-3 text-center text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
        <Link
          to="/legal?tab=terms"
          data-testid="membership-terms-link"
          className="underline underline-offset-2 rounded-ds-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Terms of Use
        </Link>
        {" · "}
        <Link
          to="/legal?tab=privacy"
          data-testid="membership-privacy-link"
          className="underline underline-offset-2 rounded-ds-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Privacy Policy
        </Link>
      </p>
    </>
  );
}
