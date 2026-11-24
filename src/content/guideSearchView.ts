import { shownDollars } from "@/lib/pickPriceShown.mjs";
import { LOUISIANA_MADE_BRANDS } from "@/content/giftGuides";
import { guideBySlug, type CatalogGuide, type CatalogPick } from "@/content/giftGuideCatalog";
import { ageBands, tagKey, type KidTags } from "@/content/giftGuideKidsFilter";
import { SEARCH_GUIDE_NAMES, searchPageBySlug, type SearchPage } from "@/content/guideSearchPages.mjs";

/**
 * The search pages' matcher and page view (owner 2026-11-23, "add a lot of different searches"): which of the live
 * Her, Him and Kids picks a search page (src/content/guideSearchPages.mjs) holds, by data the picks already carry, and
 * the guide object the page draws (GiftGuides.tsx -> GiftGuideView, the same cards as the full guide). The build's
 * pre-JS body (src/prerender/seoData.ts) and the guard (src/test/guideSearchPages1123.test.ts) use the same matcher.
 */

/**
 * Louisiana, by the pick's own words: a brand on the site's Louisiana-made list (giftGuides.ts LOUISIANA_MADE_BRANDS)
 * or one of these Louisiana companies, or a Louisiana place, team or word in its name. Never a guess from the store.
 */
const LOUISIANA_BRANDS = ["Mignon Faget", "Toups and Co", "Haydel's Bakery", "Junior League of Lafayette", "Pelican Publishing"];
const LOUISIANA_WORDS = /\b(louisiana|lsu|saints|new orleans|nola|cajun|creole|fleur de lis|crawfish|pelican)\b/i;
const isLouisianaPick = (p: Pick<CatalogPick, "name" | "brand">): boolean =>
  Boolean(p.brand && (LOUISIANA_MADE_BRANDS.includes(p.brand) || LOUISIANA_BRANDS.includes(p.brand))) || LOUISIANA_WORDS.test(p.name);

/** Whether a page needs the Kids tag file (an age page). */
export const searchNeedsTags = (page: SearchPage) => Boolean(page.match.ages?.length);

/** True when `pick` belongs on `page` (every match key narrows). A price key needs a price; the card's whole dollars count. */
function matchesSearch(page: SearchPage, pick: CatalogPick, tags: KidTags | null): boolean {
  const m = page.match;
  if (m.under !== undefined || m.atLeast !== undefined) {
    if (!pick.price || !(pick.price > 0)) return false;
    const d = shownDollars(pick.price);
    if (m.under !== undefined && !(d < m.under)) return false;
    if (m.atLeast !== undefined && !(d >= m.atLeast)) return false;
  }
  if (m.types && !(pick.type && m.types.includes(pick.type))) return false;
  if (m.ages) {
    const bands = ageBands(tags?.[tagKey(pick.href)]);
    if (!bands.some((b) => m.ages!.includes(b))) return false;
  }
  if (m.louisiana && !isLouisianaPick(pick)) return false;
  return true;
}

/** A page's picks: each listed guide's picks in turn, one row per gift (link + name, as the page keys a row), that match. */
export function searchPagePicks(page: SearchPage, picksOf: (guide: string) => CatalogPick[], tags: KidTags | null): CatalogPick[] {
  const seen = new Set<string>();
  return page.guides.flatMap(picksOf).filter((p) => {
    const key = `${p.href} ${p.name}`;
    if (!p.name || !p.href || seen.has(key)) return false;
    seen.add(key);
    return matchesSearch(page, p, tags);
  });
}

/**
 * The guide object a search page draws: its first guide's look (tint, cover), its own slug, banner words and the
 * matching picks, read live from the loaded chunks (the catalog loads every listed guide's chunk for its slug).
 * `view` marks it a view, never a guide of its own (no tile, menu entry or Q&A). Null for any other slug.
 */
export function searchGuide(slug: string | undefined, tags: KidTags | null): CatalogGuide | null {
  const page = slug ? searchPageBySlug(slug) : null;
  const parent = page ? guideBySlug(page.guides[0]) : undefined;
  if (!page || !parent) return null;
  const g: CatalogGuide = { ...parent, slug: page.slug, lead: page.lead, title: page.name, age: undefined, line: page.intro, links: [], picks: [], view: { of: parent.slug, rel: "search" } };
  delete g.deals;
  Object.defineProperty(g, "picks", { enumerable: true, get: () => searchPagePicks(page, (s) => guideBySlug(s)?.picks ?? [], tags) });
  return g;
}

/** The link back a search page shows: its one guide, else the gift guides page. */
export const searchBackLink = (page: SearchPage): { href: string; label: string } =>
  page.guides.length === 1 && Object.prototype.hasOwnProperty.call(SEARCH_GUIDE_NAMES, page.guides[0])
    ? { href: `/gift-guides/${page.guides[0]}`, label: `See the full ${SEARCH_GUIDE_NAMES[page.guides[0]]} guide` }
    : { href: "/gift-guides", label: "See every gift guide" };
