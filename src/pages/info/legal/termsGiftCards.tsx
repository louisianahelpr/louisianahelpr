/**
 * The Terms "Gift cards" row's words (MON-1123-01, 2026-11-23): gift cards never expire (La. R.S. 51:1423;
 * 12 CFR 1005.20), migration 20261123090716. Each sentence is what the code does: restore_gift_card_for_job and
 * restore_gift_card_for_declutter_order give a refunded gift share back as gift credit; revoke_gift_card_for_refund
 * stops a card whose purchase was refunded or charged back.
 *
 * A JSX value, not a component: TermsSection keeps the PolicyRowItem (PolicySection reads each row's `title` for the
 * Terms search) and the search highlighter walks these <p> elements as if they were inline. Its own file keeps
 * TermsSection.tsx under the 600-line component limit (componentSizeRatchet). Guard: src/test/giftCardsNeverExpire.test.tsx.
 */
export const GIFT_CARDS_TERMS_BODY = (
  <>
    <p><strong className="text-foreground">Gift cards never expire.</strong> The credit stays good until it is used up.</p>
    <p><strong className="text-foreground">Using one:</strong> the person it is sent to claims it from the link we email them, then uses the credit toward jobs on Helpr and Declutter buys.</p>
    <p><strong className="text-foreground">Refunds:</strong> if a job or purchase paid with gift card credit is cancelled or refunded in full, the gift card part comes back as gift card credit. If the payment for a gift card is refunded in full or disputed, any credit left on that gift card is cancelled and can no longer be used.</p>
  </>
);
