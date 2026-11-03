/**
 * Declutter SHIPPING copy for the Help Center and the Terms (Q2259, spec S8: Terms row 24 + Help "how to ship").
 *
 * Shown ONLY where the `declutter_shipping` switch is on (useFeature, read by HelpCenter.tsx and TermsSection.tsx).
 * Everywhere else the pages keep "Shipping isn't offered." / "Shipping is not offered.", which stays true there: while
 * the switch is testers-only, nobody else can pick shipping at checkout or turn on Ship it on a listing (the RPCs call
 * require_feature too). When the owner flips the switch to everyone, this copy reaches everyone with it.
 *
 * Every sentence restates built behaviour; the source of each is beside it. The Help answers and the Terms paragraphs
 * say the same facts; change them together (the Help file's own rule, helpCenterContent.ts "Declutter").
 */

/** Replaces "Shipping isn't offered." in Help's "How do I get the item?" (ship_preset needs delivery_size 'small',
 *  20261030012052; Louisiana ZIPs only, decision 3, checked by ship-rates). */
export const HELP_SHIPPING_GET_ITEM = "Small items can also be shipped to a Louisiana address.";

/** Replaces "Shipping is not offered." in the Terms' "What Declutter is" card. */
export const TERMS_SHIPPING_GET_ITEM =
  "Small items can also be shipped to a Louisiana address when the seller turns shipping on; the Shipping rules are below.";

export const HELP_SHIPPING_ITEMS: { q: string; a: string }[] = [
  {
    // ship-rates returns at most 3 options, cheapest first (decision 13); manual-capture hold released when no label
    // can be bought (S3 6b4cd65f31, cddab0cac0); ship-by 3 business days (declutter_ship_by); shipped/delivered
    // notices (20261103201840).
    q: "How does shipping work when I buy?",
    a: "Pick Ship it to me at checkout and enter a Louisiana street address. You see up to three postage choices, cheapest first, and shipping shows as its own line in your total. Your card is only held at first: if the label can't be bought, the hold is released and you're never charged. The seller has 3 business days to hand the package to the carrier, and you can track it on your order. We tell you when it ships and when it's delivered.",
  },
  {
    // Spec 5.3: never-shipped sweep (19be83ce1e) and ship_lost sweep (20261103203204) refund everything; a problem
    // reported in the 2-day window (24 h to the auto handover + 24 h refund window, S5 281d8f4a97) is decided by an
    // admin; return-to-sender / failure scans open a problem (20261103204805); decision 6: a lost or broken parcel is
    // the seller's, the spent label is a seller debt (e17e47e0b5, 20261102045553, 20261103203204).
    q: "What if my package doesn't come, or arrives broken?",
    a: "After it's delivered you have 2 days to check it. If it arrived broken or isn't as described, report a problem on your order within those 2 days: we check, and you get everything back, shipping included. If the seller doesn't ship it in time, the sale is cancelled and you get everything back. If it's never delivered 10 days after the carrier took it, you get everything back too. If the carrier sends it back or can't deliver it, we look at the order and the money stays held until we decide. Lost or broken in the mail is the seller's cost, never yours.",
  },
  {
    // ShipItRow + 20261103201144 (restricted-items tick, electronics/appliances pickup only, small only); label
    // bought by the label worker; packed / ship-by (1006b29a83); payout on final (S5); never shipped =
    // seller_backed_out + strike (19be83ce1e); ship_lost = no strike, label debt (20261103203204); debts come out of
    // the next payout (declutter_consume_fee_debt).
    q: "How do I ship something I sold?",
    a: "In Manage listing, turn on Ship it: confirm nothing in it is on the USPS restricted list (no sprays, perfume, nail polish, batteries, matches or lighters) and pick the box it fits in. Only small items can ship, and electronics and appliances are pickup only. When it sells, the label is bought for you: print it from the order, pack the item and hand it to the carrier within 3 business days. You're paid once the buyer has had 2 days after delivery to report a problem. If it's lost or arrives broken, the buyer gets everything back and the label, plus a return label if we ask for the item back, comes out of your next payout. Missing the ship-by date cancels the sale and is a Declutter strike.",
  },
];

/** The Terms' "Shipping" row (spec 5.3 and 7; same facts as the Help answers above). */
export const TERMS_SHIPPING_PARAGRAPHS: string[] = [
  "Shipping is for small items, to a Louisiana address. The seller turns it on for a listing and confirms nothing in it is on the USPS restricted list; electronics and appliances are pickup only. At checkout you see up to three postage choices, cheapest first, and you pay the postage shown, as its own line in your total.",
  "Your card is held, not charged, until the label is bought. If the label can't be bought, the hold is released and you are never charged. The seller hands the package to the carrier within 3 business days; if they don't, the sale is cancelled, you get everything back, and the seller gets a Declutter strike.",
  "After delivery you have 2 days to report a problem; the seller is paid only after that. If it arrived broken or isn't as described and you report it in those 2 days, Louisiana Helpr checks it and you get everything back. If it is never delivered 10 days after the carrier took it, you get everything back. If the carrier returns it or can't deliver it, the money stays held until Louisiana Helpr decides.",
  "A parcel lost or broken in the mail is the seller's cost, never the buyer's: the spent label, and a return label if Louisiana Helpr asks for the item back, come out of the seller's next payouts. After the 2 days the sale is final.",
];

/** The Help sections with shipping on: "Shipping isn't offered." becomes the shipping sentence and the three shipping
 *  answers follow "How do I get the item?". Returns new arrays; FAQ_SECTIONS itself never changes. */
export function withDeclutterShipping<T extends { topic: string; items: { q: string; a: string }[] }>(sections: T[]): T[] {
  return sections.map((section) => {
    if (section.topic !== "Declutter") return section;
    const items = section.items.flatMap((item) =>
      item.q === "How do I get the item?"
        ? [{ ...item, a: item.a.replace("Shipping isn't offered.", HELP_SHIPPING_GET_ITEM) }, ...HELP_SHIPPING_ITEMS]
        : [item]);
    return { ...section, items };
  });
}
