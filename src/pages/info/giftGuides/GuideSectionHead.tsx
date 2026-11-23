import type { ReactNode } from "react";
import { giftGuides as G } from "@/content/giftGuides";
import { Button } from "@/components/ui/button";
import { ICON_STROKE_PX } from "@/lib/iconWeight";

/**
 * One section header for the gift guides (owner 2026-11-21: "there should be a button to open and expand each section
 * like for under 25 etc."; owner 2026-11-22: "Add some kind of shading or something so you can tell where each section
 * is better"): an h2 holding a full-width 48px open/close button (aria-expanded, aria-controls the section's body), drawn
 * as a band in a light tint of its page's colour (h2 class gg-sec-<tint>, giftGuidesStyles.ts), the title, its count in
 * brackets and a chevron at the right.
 *
 * The one header every sectioned page uses: the Her, Him and Kids price sections (GiftGuideView.tsx) and the deals days'
 * Top deals, Discount codes and Sales (GiftGuideDeals.tsx; owner 2026-11-22: "on black friday page. top deals, sales,
 * and discount codes need to have the same layout and design as the collapse and expand sections on the his and hers
 * guides. same for cyber monday"). Each page starts every section open (START_OPEN) and owns its own open state.
 * `count` null = still loading: no count yet.
 * Guard: src/test/giftGuideSectionBands1122.test.tsx.
 */
export function GuideSectionHead({ titleId, bodyId, title, count, tint, open, onToggle, data }: {
  titleId: string;
  bodyId: string;
  title: ReactNode;
  count: number | null;
  tint: string;
  open: boolean;
  onToggle: () => void;
  data: Record<`data-${string}`, string>;
}) {
  const toggle = (
    <Button type="button" variant="ghost" size="md" className="gg-sec-toggle" aria-expanded={open} aria-controls={bodyId} onClick={onToggle} {...data}>
      <span>{title}{count !== null && <span className="gg-sec-count" data-gift-section-count="">{G.priceSectionCount(count)}</span>}</span>
      <svg className="gg-sec-chev" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE_PX} strokeLinecap="round" strokeLinejoin="round" /></svg>
    </Button>
  );
  return <h2 className={`gg-sec-title gg-sec-toggle-h gg-sec-${tint}`} id={titleId}>{toggle}</h2>;
}
