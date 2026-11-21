import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";
import { KID_AGE_BANDS, KIDS_HUB, guideBySlug } from "@/content/giftGuideCatalog";
import { SECTION_ANCHORS, SECTION_PICK_COUNTS } from "@/content/giftGuidePicks";

/**
 * The kids age guides, two taps from the landing (holistic review 11-18 H1: the 12 age guides were reachable only through
 * search or the BY AGE row on Girls and Boys, so "a gift for my 4-year-old niece" failed). Each age that holds picks is a
 * 44px chip; one that holds nothing is left out (never a dead link).
 */
/**
 * An age's link (follow-up 1120, owner 11-20 ~1:10 AM: ONE Kids guide by age, each age mixing girls, boys and any): the
 * Kids page at that age's section, "/gift-guides/kids#toddlers", when the section holds picks; else null.
 */
const ageLink = (tail: string) => {
  // Teens is its own guide (owner 11-20 evening): the 13+ chip opens it.
  if (tail === "teens") {
    const t = guideBySlug("teens");
    return t && !t.empty ? { slug: "teens", to: "/gift-guides/teens" } : null;
  }
  const g = guideBySlug(KIDS_HUB);
  const id = SECTION_ANCHORS[`girls-${tail}`] ?? SECTION_ANCHORS[`boys-${tail}`] ?? SECTION_ANCHORS[`gender-neutral-${tail}`];
  return g && !g.empty && id && (SECTION_PICK_COUNTS[id] ?? 0) > 0 ? { slug: id, to: `/gift-guides/${KIDS_HUB}#${id}` } : null;
};

const ages = (b: (typeof KID_AGE_BANDS)[number]) => b.ages;

/** The Kids by age block's anchor: the landing's "Kids by age" chip links to it (gg-r3 UX audit #17). */
export const KIDS_BY_AGE_ID = "kids-by-age";

/** "Kids by age" (landing, For kids): one chip per age band ("Little kids 4–7"), each opening that section of Kids. */
export function KidsByAge() {
  const { hash } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  // React Router does not scroll to a hash on its own: opened from the chip, the block scrolls into view.
  useEffect(() => {
    if (hash === `#${KIDS_BY_AGE_ID}`) ref.current?.scrollIntoView({ block: "start" });
  }, [hash]);
  const bands = KID_AGE_BANDS.flatMap((b) => {
    const g = ageLink(b.tail);
    return g ? [{ b, g }] : [];
  });
  if (bands.length === 0) return null;
  return (
    <div ref={ref} id={KIDS_BY_AGE_ID} className="gg-ages" aria-labelledby="gift-ages" data-gift-ages="" role="group">
      <h3 id="gift-ages" className="gg-ages-title">{G.agesTitle}</h3>
      <span className="gg-chips">
        {bands.map(({ b, g }) => (
          <Button key={b.tail} asChild variant="outline" size="sm" className="gg-chip">
            <Link to={g.to} data-gift-age-link={g.slug} data-gift-age-band={b.tail}>
              {b.label} {ages(b)}
            </Link>
          </Button>
        ))}
      </span>
    </div>
  );
}

/** Which guides show BY AGE chips at their top (follow-up 1120: Family, whose Niece & Nephew section shops by age). */
const AGE_CHIPS_ON = new Set(["family"]);

/** BY AGE chips at the top of the Family page: the Kids guide's age sections, babies to teens. */
export function AgeChips({ slug }: { slug: string }) {
  if (!AGE_CHIPS_ON.has(slug)) return null;
  const chips = KID_AGE_BANDS.flatMap((b) => {
    const g = ageLink(b.tail);
    return g ? [{ b, g }] : [];
  });
  if (chips.length === 0) return null;
  return (
    <nav className="gg-agechips" aria-label={G.byAgeLabel} data-gift-age-chips={KIDS_HUB}>
      <span className="gg-ages-title">{G.byAgeLabel}</span>
      <span className="gg-chips">
        {chips.map(({ b, g }) => (
          <Button key={b.tail} asChild variant="outline" size="sm" className="gg-chip">
            <Link to={g.to} data-gift-age-link={g.slug}>
              {b.label} {ages(b)}
            </Link>
          </Button>
        ))}
      </span>
    </nav>
  );
}
