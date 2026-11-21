import { giftGuides as G } from "@/content/giftGuides";

/**
 * The gift guides' affiliate disclosures, as one footer every page with an affiliate link renders: the guides
 * (GiftGuides.tsx) and the fun pages (fun/FunPage.tsx FunBody: Swipe, the Gift Planner, Secret Santa and its reveal's
 * gift ideas). FTC 16 CFR 255.5 wants the material connection disclosed wherever an affiliate link appears, and the
 * Amazon Associates Operating Agreement wants its exact statement on every page with Amazon links (holiday audit D H3,
 * 11-20). Owner decision 2026-11-18 (~8:50 AM): plain muted lines at the BOTTOM, no box.
 * Guard: src/test/giftDisclosureEverywhere.test.tsx.
 */
export function GiftDisclosure() {
  return (
    <footer className="gg-disc">
      <p data-gift-disclosure="">{G.disclosure}</p>
      <p data-gift-amazon-statement="">{G.amazonStatement}</p>
    </footer>
  );
}
