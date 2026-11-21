import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PEOPLE_GUIDES } from "@/content/giftGuidePeople.mjs";
import { guideBySlug, type CatalogGuide } from "@/content/giftGuideCatalog";

/** The chip row's words (owner pop-up 11-20: For Her + For Him, relationship chips filter the same list). */
export const PEOPLE_CHIP_WORDS = { label: "Shopping for", all: "Everyone" };

/**
 * For Her and For Him (owner pop-up 2026-11-20 ~6:50 PM): one chip per relationship at the top of the guide (Her: Mom,
 * Wife, Girlfriend, Sister, Mother-in-law; Him: Dad, Husband, Boyfriend, Brother, Father-in-law). Each chip opens that
 * relationship's own page, /gift-guides/mom, which is the same list filtered by each pick's tags (the in-law pages leave
 * out boots and anything too young or trendy). "Everyone" opens the whole guide. A relationship with no picks has no chip.
 * Guard: src/test/giftGuidePeople1120.test.ts.
 */
export function PeopleChips({ guide }: { guide: CatalogGuide }) {
  const of = guide.view?.of ?? guide.slug;
  const people = PEOPLE_GUIDES.find((g) => g.slug === of);
  if (!people) return null;
  const current = guide.view?.rel ?? null;
  const chips = [
    { slug: of, label: PEOPLE_CHIP_WORDS.all, on: current === null },
    ...people.rels.filter((r) => guideBySlug(r.slug)).map((r) => ({ slug: r.slug, label: r.label, on: current === r.slug })),
  ];
  return (
    <nav aria-label={PEOPLE_CHIP_WORDS.label} className="gg-people" data-gift-people-chips={of}>
      <p className="gg-people-q">{PEOPLE_CHIP_WORDS.label}</p>
      <span className="gg-chips">
        {chips.map((c) => (
          <Button key={c.slug} asChild variant="outline" size="sm" className={c.on ? "gg-chip btn-grad-primary" : "gg-chip"}>
            <Link to={`/gift-guides/${c.slug}`} aria-current={c.on ? "page" : undefined} data-gift-people-chip={c.slug}>{c.label}</Link>
          </Button>
        ))}
      </span>
    </nav>
  );
}
