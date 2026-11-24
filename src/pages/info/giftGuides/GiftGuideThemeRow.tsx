import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { guideBySlug } from "@/content/giftGuideCatalog";
import { THEME_GUIDES_1124 } from "@/content/giftGuideLive.mjs";
import { giftGuides as G } from "@/content/giftGuides";
import { RowNudgeButton } from "@/components/ui/RowNudgeButton";
import { useIsWebDesktop } from "@/hooks/useIsWebDesktop";
import { GiftGuideTile } from "./GiftGuideTile";

/** Covers that load at once; the rest load lazily as the row scrolls to them (each keeps its square, so nothing moves). */
const EAGER_COVERS = 2;

/**
 * The themed kids guides' GREEN covers in one sideways row, right under the red "gifts for Kids" banner (owner
 * 2026-11-24 ~2:05 PM: "Each of these new covers should be here and scroll left to right and then the other items will
 * go below like the items that are already there ... The new guides should be green under this red one"). One tile per
 * THEME_GUIDES_1124 entry, in menu order, so an imported theme appears here by itself; each opens /gift-guides/<slug>.
 * A phone swipes it (snap, the next cover peeking in); a desktop also gets round arrows once the row overflows. The
 * shared tile and cover (GiftGuideTile / GiftGuideCover): the cover prints the guide's name, so the name is for screen
 * readers only. Guard: src/test/giftGuideKidsThemeRow1124.test.tsx.
 */
export function GiftGuideThemeRow() {
  const desktop = useIsWebDesktop();
  const row = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const measure = useCallback(() => {
    const el = row.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((m) => (m.left === left && m.right === right ? m : { left, right }));
  }, []);
  useEffect(() => {
    const el = row.current;
    if (!el || !desktop) return;
    measure();
    if (typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [desktop, measure]);
  const nudge = (dir: 1 | -1) => {
    const el = row.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.8), behavior: "smooth" });
  };
  const guides = THEME_GUIDES_1124.map((slug) => guideBySlug(slug)).filter((g) => g !== undefined);
  if (guides.length === 0) return null;
  return (
    <section className="gg-themes" aria-label={G.themeRowLabel} data-gift-theme-row="">
      <ul ref={row} className="gg-row gg-themes-row" onScroll={desktop ? measure : undefined}>
        {guides.map((g, i) => <GiftGuideTile key={g.slug} g={g} priority={i < EAGER_COVERS} />)}
      </ul>
      {desktop && edges.left && (
        <div className="gg-themes-edge gg-themes-edge-left" data-gift-theme-edge="left">
          <RowNudgeButton aria-label={G.themeRowEarlier} onClick={() => nudge(-1)}><ChevronLeft className="h-5 w-5" aria-hidden /></RowNudgeButton>
        </div>
      )}
      {desktop && edges.right && (
        <div className="gg-themes-edge gg-themes-edge-right" data-gift-theme-edge="right">
          <RowNudgeButton aria-label={G.themeRowMore} onClick={() => nudge(1)}><ChevronRight className="h-5 w-5" aria-hidden /></RowNudgeButton>
        </div>
      )}
    </section>
  );
}
