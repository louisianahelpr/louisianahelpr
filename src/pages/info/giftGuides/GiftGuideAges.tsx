import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { giftGuides as G } from "@/content/giftGuides";
import { KID_AGE_BANDS, KID_AGE_HUBS, guideBySlug } from "@/content/giftGuideCatalog";
import { SECTION_ANCHORS, SECTION_PICK_COUNTS } from "@/content/giftGuidePicks";

/**
 * The kids age guides, two taps from the landing (holistic review 11-18 H1: the 12 age guides were reachable only through
 * search or the BY AGE row on Girls and Boys, so "a gift for my 4-year-old niece" failed). Each age guide that holds
 * picks is a 44px chip; one that holds nothing is left out (never a dead link).
 */
/**
 * An age's link (1120: the 15 age guides are sections of Girls, Boys and Gender-Neutral now): the hub's page at that
 * section, "/gift-guides/girls#girls-toddlers", when the section holds picks; else null (never a dead link).
 */
const ageLink = (hub: string, tail: string) => {
  const g = guideBySlug(hub);
  const id = SECTION_ANCHORS[`${hub}-${tail}`];
  return g && !g.empty && id && (SECTION_PICK_COUNTS[id] ?? 0) > 0 ? { slug: id, to: `/gift-guides/${hub}#${id}` } : null;
};

/** The ages a row shows: babies to teens (the teen tiles left the For kids row with the 1120 merge). */
const BANDS = KID_AGE_BANDS;
const ages = (b: (typeof KID_AGE_BANDS)[number]) => b.ages;

/**
 * "Kids by age" (landing, For kids): one line per age band ("Little kids 4–7"), each with Girls, Boys and Gender-neutral
 * chips to that band's guides.
 */
/** The Kids by age block's anchor: the landing's "Kids by age" chip links to it (gg-r3 UX audit #17). */
export const KIDS_BY_AGE_ID = "kids-by-age";

export function KidsByAge() {
  const { hash } = useLocation();
  const ref = useRef<HTMLDivElement>(null);
  // React Router does not scroll to a hash on its own: opened from the chip, the block scrolls into view.
  useEffect(() => {
    if (hash === `#${KIDS_BY_AGE_ID}`) ref.current?.scrollIntoView({ block: "start" });
  }, [hash]);
  const rows = BANDS.map((b) => ({ b, hubs: KID_AGE_HUBS.flatMap((h) => (ageLink(h, b.tail) ? [{ h, g: ageLink(h, b.tail)! }] : [])) })).filter((r) => r.hubs.length > 0);
  if (rows.length === 0) return null;
  return (
    <div ref={ref} id={KIDS_BY_AGE_ID} className="gg-ages" aria-labelledby="gift-ages" data-gift-ages="" role="group">
      <h3 id="gift-ages" className="gg-ages-title">{G.agesTitle}</h3>
      <ul>
        {rows.map(({ b, hubs }) => (
          <li key={b.tail} data-gift-age-band={b.tail}>
            <span className="gg-age-name">{b.label} <small>{ages(b)}</small></span>
            <span className="gg-chips">
              {hubs.map(({ h, g }) => (
                <Button key={h} asChild variant="outline" size="sm" className="gg-chip">
                  <Link to={g.to} data-gift-age-link={g.slug}>
                    {G.ageHubLabels[h]}<span className="sr-only">, {b.label.toLowerCase()} {ages(b)}</span>
                  </Link>
                </Button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Which kids hub a guide's BY AGE chips open (1120: Niece & Nephew is one guide; its chips open the gender-neutral ages). */
const AGE_CHIPS_FOR: Record<string, (typeof KID_AGE_HUBS)[number]> = { "niece-and-nephew": "gender-neutral" };

/** BY AGE chips at the top of the Niece & Nephew page: that hub's age sections, babies to teens. */
export function AgeChips({ slug }: { slug: string }) {
  const hub = AGE_CHIPS_FOR[slug];
  if (!hub) return null;
  const chips = KID_AGE_BANDS.flatMap((b) => {
    const g = ageLink(hub, b.tail);
    return g ? [{ b, g }] : [];
  });
  if (chips.length === 0) return null;
  return (
    <nav className="gg-agechips" aria-label={G.byAgeLabel} data-gift-age-chips={hub}>
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
