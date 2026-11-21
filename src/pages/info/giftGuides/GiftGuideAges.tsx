import { Link } from "react-router-dom";
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
