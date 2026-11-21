import { giftGuides as G } from "@/content/giftGuides";
import type { CatalogPick } from "@/content/giftGuideCatalog";
import { GiftOut } from "@/pages/info/giftGuides/GiftOut";

/**
 * The guide page's one calm "Try Prime free for fast holiday shipping" line (Amazon Associates bounty, lead 11-21;
 * Amazon's rules and amount: src/content/giftGuides.ts `primeTrial`). Drawn once per list, under the picks, only when
 * the rows on screen include an Amazon pick; never on a card. The page's Amazon Associate statement covers it.
 * Guard: src/test/giftGuidePrimeTrial1121.test.tsx.
 */
export function PrimeTrialLink({ picks }: { picks: readonly CatalogPick[] }) {
  if (!picks.some((p) => p.store === "amazon")) return null;
  return (
    <p className="gg-price-note" data-gift-prime-trial="">
      <GiftOut href={G.primeTrial.href} className="gg-prime-trial">{G.primeTrial.label}</GiftOut>
    </p>
  );
}
