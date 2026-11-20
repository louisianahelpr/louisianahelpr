import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { GUIDES, MERGED_GUIDES, OLD_SLUGS, RETIRED_SLUGS, ROWS, STORES, childrenOf, guidesIn, loadAllGuidePicks, newSlugFor, relatedGuides } from "@/content/giftGuideCatalog";
import type { SeoData, SeoGuide } from "@/lib/seoBodies.mjs";

/**
 * SEO P1 (owner 11-19): the gift guide data api/share.ts needs to write each guide's body, ItemList and 404s with no
 * JavaScript (src/lib/seoBodies.mjs). Built from the page's own catalog (giftGuideCatalog.ts: the same guides, picks,
 * stores, groups and old-slug forwarding the page uses), so the raw HTML cannot drift from the page.
 * scripts/prerender-static-pages.mjs writes it to scripts/generated/seo-data.js at build time (gitignored, like
 * og-shell.js); the function bundle carries only names, stores and links, never the photos or lines.
 * Guard: src/test/seoPageBodies.test.ts.
 */

/** A long guide's list in the raw HTML stops here (the page shows the rest): keeps the response small. */
const SEO_MAX_PICKS = 40;

export async function buildSeoData(): Promise<SeoData> {
  await loadAllGuidePicks();
  const guides: Record<string, SeoGuide> = {};
  for (const g of GUIDES) {
    const indexed = Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, g.slug);
    const name = indexed ? GIFT_GUIDE_SEO[g.slug] : `${g.title} gift guide`;
    const seen = new Set<string>();
    const picks: SeoGuide["picks"] = [];
    // A guide kept out of search (noindex) needs no list in the raw HTML: only its name, so its link answers 200, not 404.
    for (const p of indexed ? g.picks : []) {
      if (picks.length >= SEO_MAX_PICKS) break;
      if (!p.name || !p.href || seen.has(p.href)) continue;
      seen.add(p.href);
      const store = STORES[p.store]?.name ?? "";
      // "a 25 Days sponsor" reads oddly in a list: the brand is the store there.
      picks.push([p.name, p.store === "sponsor" && p.brand ? p.brand : store, p.href]);
    }
    // A hub (For Kids, Girls...) lists its child guides; any other guide, its siblings.
    const related = (g.children ? childrenOf(g) : relatedGuides(g))
      .filter((r) => Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, r.slug))
      .map((r) => [r.slug, GIFT_GUIDE_SEO[r.slug]] as [string, string]);
    guides[g.slug] = { name, indexed, picks, count: indexed ? new Set(g.picks.filter((p) => p.name && p.href).map((p) => p.href)).size : 0, ...(related.length ? { related } : {}) };
  }
  const moved: Record<string, string> = {};
  for (const old of [...Object.keys(OLD_SLUGS), ...Object.keys(MERGED_GUIDES), ...RETIRED_SLUGS()]) {
    const to = newSlugFor(old);
    if (to && to !== old && !guides[old]) moved[old] = to;
    // 1120: a folded store page (no page of its own, its items in the guides) opens the gift guides landing page ("").
    else if (!to && !guides[old] && old.startsWith("store-")) moved[old] = "";
  }
  const groups: SeoData["groups"] = ROWS.map((r) => [
    r.label,
    guidesIn(r.row)
      .filter((g) => guides[g.slug]?.indexed)
      .map((g) => [g.slug, guides[g.slug].name] as [string, string]),
  ]).filter(([, list]) => list.length > 0) as SeoData["groups"];
  return { guides, moved, groups };
}
