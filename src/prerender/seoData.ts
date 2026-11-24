import { GIFT_GUIDE_SEO } from "@/content/giftGuideSeo.mjs";
import { SEARCH_PAGES } from "@/content/guideSearchPages.mjs";
import { searchPagePicks } from "@/content/guideSearchView";
import type { KidTags } from "@/content/giftGuideKidsFilter";
import kidTagsFile from "@/content/giftGuideKidsTags.json";
import { GUIDES, MERGED_GUIDES, guideBySlug, type CatalogPick, OLD_SLUGS, RETIRED_SLUGS, ROWS, STORES, childrenOf, guidesIn, loadAllGuidePicks, newSlugFor, relatedGuides } from "@/content/giftGuideCatalog";
import type { SeoData, SeoGuide } from "@/lib/seoBodies.mjs";
import { DEALS_WORDS, DEAL_DAY_SLUGS, DEAL_EVENTS, dealEnds, type Deal } from "@/content/giftGuideDeals.mjs";
import { STORE_CODES, codeCardsOrder, dealDayLists, dealDayParts } from "@/content/giftGuideDealCounts";
import { publicPartners } from "@/components/sponsor/Sections";
import { sponsorPage } from "@/content/sponsorPage";
import { isLiveGuide } from "@/content/giftGuideLive.mjs";
import { RETIRED_TO_SEARCH_PAGE } from "@/content/retiredGuideForward";
import deals from "@/content/giftGuideDeals.json";
import smallBiz from "@/content/giftGuideSmallBiz.json";
import { QA_PAGES, toQaPick } from "@/lib/guideQa.mjs";

/**
 * SEO P1 (owner 11-19): the gift guide data api/share.ts needs to write each guide's body, ItemList and 404s with no
 * JavaScript (src/lib/seoBodies.mjs). Built from the page's own catalog (giftGuideCatalog.ts: the same guides, picks,
 * stores, groups and old-slug forwarding the page uses), so the raw HTML cannot drift from the page.
 * scripts/prerender-static-pages.mjs writes it to scripts/generated/seo-data.js at build time (gitignored, like
 * og-shell.js); the function bundle carries names, stores, links, and (structured data 1121) each pick's photo URL and
 * checked price with its day, never the lines.
 * Guard: src/test/seoPageBodies.test.ts.
 */

/**
 * One pick as the pre-JS rows carry it: name, where (a 25 Days sponsor's brand, else the store; "a 25 Days sponsor"
 * reads oddly in a list), link, and (structured data, lead 11-21) its photo URL and checked price for the ItemList of
 * Products (seoBodies.mjs giftGuideItemListLd); whether the price shows is decided per request, as the card decides it.
 */
function seoPick(p: CatalogPick): SeoGuide["picks"][number] {
  const store = STORES[p.store]?.name ?? "";
  const extra = { ...(p.image ? { image: p.image } : {}), ...(p.price && p.priceAt ? { price: p.price, priceAt: p.priceAt } : {}) };
  const where = p.store === "sponsor" && p.brand ? p.brand : store;
  return Object.keys(extra).length ? [p.name, where, p.href, extra] : [p.name, where, p.href];
}

export async function buildSeoData(): Promise<SeoData> {
  await loadAllGuidePicks();
  const guides: Record<string, SeoGuide> = {};
  for (const g of GUIDES) {
    const indexed = Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, g.slug);
    const name = indexed ? GIFT_GUIDE_SEO[g.slug] : `${g.title} gift guide`;
    const seen = new Set<string>();
    const picks: SeoGuide["picks"] = [];
    // A guide kept out of search (noindex) needs no list in the raw HTML: only its name, so its link answers 200, not 404.
    // Seo bodies 1123 (technical SEO audit TS4): every pick, not the first 40. A 40 cap left readers with no JavaScript (AI
    // assistants) only the cheapest picks of Her, Him and Kids while the intro said 159 (size measured in the commit).
    for (const p of indexed ? g.picks : []) {
      // One row per gift as the page draws it (its key: link + name, GiftGuideView.tsx PickRow): the 25 Days sponsors with no
      // shop of their own all link our /25days page, and a link-only key dropped 3 of those 4 (crawler 105 vs the page 108).
      const key = `${p.href} ${p.name}`;
      if (!p.name || !p.href || seen.has(key)) continue;
      seen.add(key);
      picks.push(seoPick(p));
    }
    // A hub (For Kids, Girls...) lists its child guides; any other guide, its siblings.
    const related = (g.children ? childrenOf(g) : relatedGuides(g))
      .filter((r) => Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, r.slug))
      .map((r) => [r.slug, GIFT_GUIDE_SEO[r.slug]] as [string, string]);
    // Guide Q&A (owner pop-up 11-22 9:40 PM): every pick, in the page's order, as the Q&A reads it (guideQa.mjs toQaPick).
    const qa = indexed && QA_PAGES.includes(g.slug) ? g.picks.filter((p) => p.name).map(toQaPick) : [];
    guides[g.slug] = { name, indexed, picks, count: indexed ? new Set(g.picks.filter((p) => p.name && p.href).map((p) => `${p.href} ${p.name}`)).size : 0, ...(related.length ? { related } : {}), ...(qa.length ? { qa } : {}) };
  }
  const moved: Record<string, string> = {};
  for (const old of new Set([...Object.keys(OLD_SLUGS), ...Object.keys(MERGED_GUIDES), ...RETIRED_SLUGS(), ...Object.keys(RETIRED_TO_SEARCH_PAGE)])) {
    const to = newSlugFor(old);
    if (to && to !== old && !guides[old]) moved[old] = to;
    // 1120: a folded store page (no page of its own, its items in the guides) opens the gift guides landing page ("");
    // owner 11-21: so does every retired guide (src/content/giftGuideLive.mjs: only Her, Him and Kids stay).
    else if (!to && !guides[old]) moved[old] = "";
  }
  const groups: SeoData["groups"] = ROWS.map((r) => [
    r.label,
    guidesIn(r.row)
      .filter((g) => guides[g.slug]?.indexed)
      .map((g) => [g.slug, guides[g.slug].name] as [string, string]),
  ]).filter(([, list]) => list.length > 0) as SeoData["groups"];
  // The deals days' cards (structured data 1121; one page per day, owner 11-21): name, shop link, last day and the
  // day page they show on; a day page that is not live carries none.
  // Guide Q&A 11-22: each card's brand and deal line too (the day's "What deals are on this page?").
  const dealList: SeoData["deals"] = (deals as { item?: string; href?: string; ends?: string; event?: string; brand?: string; deal?: string; starts?: string }[])
    .filter((d) => d.item && d.href && d.event && DEAL_DAY_SLUGS.includes(d.event) && isLiveGuide(d.event))
    // Guide train p 11-23: the card's real last day (dealEnds: its own end, else its store code's end), the rule the page
    // shows a card by, so the raw HTML's list and Q&A drop a card on the same day the page does.
    // Seo bodies 1123: the card's first day too, so the pre-JS list says when it runs as the card does (DEALS_WORDS.runs).
    .map((d) => [d.item as string, d.href as string, dealEnds(d as Deal, STORE_CODES) ?? "", d.event as string, d.brand ?? "", d.deal ?? "", d.starts ?? ""]);
  // Small Business Saturday's businesses for its Q&A: name, town, category, "ships" or "local".
  // Seo bodies 1123 (TS3): each one's link (the card's name link, GiftGuideSmallBiz.tsx b.href) and gift idea for the list.
  const shops: SeoData["smallBiz"] = (smallBiz as { name?: string; town?: string; category?: string; ships?: string; href?: string; gift?: string }[])
    .filter((b) => b.name)
    .map((b) => [b.name as string, b.town ?? "", b.category ?? "", b.ships ?? "", b.href ?? "", b.gift ?? ""]);
  // Seo bodies 1123 (TS3): the /25days lineup as the page draws it (Sections.tsx publicPartners: A to Z, never a day).
  const lineup: SeoData["lineup"] = {
    title: sponsorPage.lineup.title,
    intro: sponsorPage.lineup.intro,
    partners: publicPartners().map((p) => [p.brand, p.prizes, p.page ?? ""]),
  };
  // Search pages (owner 11-23): each page's picks by the page's own matcher (guideSearchView.ts), from the same chunks.
  const kidTags = (kidTagsFile as unknown as { tags: KidTags }).tags;
  const searchPages: NonNullable<SeoData["searchPages"]> = Object.fromEntries(
    SEARCH_PAGES.map((sp) => [sp.slug, searchPagePicks(sp, (s) => guideBySlug(s)?.picks ?? [], kidTags).map(seoPick)]),
  );
  return { guides, moved, groups, searchPages, deals: dealList, dealParts: dealPartsTable(), dealLists: dealListsTable(), smallBiz: shops, lineup };
}

/** The first and last day the deals days' section counts are worked out for; after the last, its counts carry on. */
const PARTS_FROM = "2026-11-01";
const PARTS_TO = "2027-12-31";

/**
 * Each deals day's Discount codes and Sales counts by date (guide train p 11-23), for the pre-JS Q&A
 * (guideQa.mjs dealPartsOn): [first day, codes, sales] rows, one per change, from giftGuideDealCounts.ts dealDayParts,
 * the same counts the page's section heads and the guides menu show. The counts move only at day boundaries (each
 * code, sale and card has a day, never a time), so a row per change is exact.
 */
function dealPartsTable(): NonNullable<SeoData["dealParts"]> {
  const out: NonNullable<SeoData["dealParts"]> = {};
  const all = deals as Deal[];
  for (const e of DEAL_EVENTS.filter((x) => x.kind === "deals" && isLiveGuide(x.id))) {
    const rows: [string, number, number][] = [];
    for (let t = Date.parse(`${PARTS_FROM}T12:00:00Z`); t <= Date.parse(`${PARTS_TO}T12:00:00Z`); t += 864e5) {
      const day = new Date(t).toISOString().slice(0, 10);
      const p = dealDayParts(e.id, all, day);
      const last = rows[rows.length - 1];
      if (!last || last[1] !== p.codes || last[2] !== p.sales) rows.push([day, p.codes, p.sales]);
    }
    out[e.id] = rows;
  }
  return out;
}

/**
 * Each deals day's Discount codes and Sales rows by date (seo bodies 1123, technical SEO audit TS3: the pre-JS body
 * listed none of the 61 deals its Q&A counted), from giftGuideDealCounts.ts dealDayLists, the rows the page's sections
 * draw. Each code and sale is written once (`codes`, `sales`), and `rows` holds [first day, code indexes, sale indexes],
 * one row per change, as dealPartsTable does for the counts. A code row: [store, code, offer, when it runs (as the code
 * card says it), link], each store's best code first (codeCardsOrder); a code with no link draws no card on the page, so
 * it is left out here too. A sale row: [store, offer, link, last day].
 */
function dealListsTable(): NonNullable<SeoData["dealLists"]> {
  const out: NonNullable<SeoData["dealLists"]> = {};
  const all = deals as Deal[];
  for (const e of DEAL_EVENTS.filter((x) => x.kind === "deals" && isLiveGuide(x.id))) {
    const codes: NonNullable<SeoData["dealLists"]>[string]["codes"] = [];
    const sales: NonNullable<SeoData["dealLists"]>[string]["sales"] = [];
    const seen = new Map<string, number>();
    const indexOf = <R extends string[]>(table: R[], kind: string, row: R) => {
      const key = JSON.stringify([kind, ...row]);
      const known = seen.get(key);
      if (known !== undefined) return known;
      seen.set(key, table.length);
      table.push(row);
      return table.length - 1;
    };
    const rows: [string, number[], number[]][] = [];
    for (let t = Date.parse(`${PARTS_FROM}T12:00:00Z`); t <= Date.parse(`${PARTS_TO}T12:00:00Z`); t += 864e5) {
      const day = new Date(t).toISOString().slice(0, 10);
      const l = dealDayLists(e.id, all, day);
      const ci = codeCardsOrder(l.codes).map((c) => indexOf(codes, "code", [c.store, c.code, c.offer, DEALS_WORDS.runs(c.starts ?? null, c.expires ?? null), c.href as string]));
      const si = l.sales.flatMap((x) => x.sales).map((x) => indexOf(sales, "sale", [x.store, x.offer, x.href, x.ends]));
      const last = rows[rows.length - 1];
      if (!last || last[1].join() !== ci.join() || last[2].join() !== si.join()) rows.push([day, ci, si]);
    }
    out[e.id] = { codes, sales, rows };
  }
  return out;
}
