/**
 * The gift guides' head values, /gift-guides/<slug> (follow-up batch 2026-11-18, SEO), kept OUT of publicPageMeta.mjs
 * on purpose: GIFT_GUIDE_SEO (every indexed guide's name, ~5 KB gzip) would otherwise ride in the shared chunk every
 * page that imports publicPageMeta loads cold (Login, Signup, Index, the Declutter item page: Q178 critical path). Only
 * the gift guides page (GiftGuides.tsx) and api/share.ts import this module. Types: giftGuidePageMeta.d.mts.
 */

import { SITE_ORIGIN, NOINDEX_ROBOTS, PUBLIC_PAGE_META, publicPageMetaFor } from "./publicPageMeta.mjs";
import { GIFT_GUIDE_SEO } from "../content/giftGuideSeo.mjs";
import { dealDay } from "../content/giftGuideDeals.mjs";
import { DEAL_DAY_SEARCH_TITLES, GUIDE_SEARCH, guideSearchDescription } from "../content/guideSearch.mjs";

/** "A, B and C" */
function joinNames(names) {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** A pick name short enough for a description: cut at its first comma or dash, at most 48 characters. */
function shortName(name) {
  const s = String(name ?? "").split(/,| - | \| /)[0].trim();
  return s.length > 48 ? `${s.slice(0, 47).trimEnd()}…` : s;
}

/**
 * SEO P1 (owner 11-19; audit 11-18: all 405 guides shared one description template): a guide's own description from
 * its picks, the count and its first three names. `null` with no picks (the caller keeps the template).
 */
export function giftGuideDescription(name, topNames, count) {
  const n = Number(count) || 0;
  if (n <= 0) return null;
  const top = [...new Set((topNames ?? []).map(shortName).filter(Boolean))].slice(0, 3);
  return `${name} 2026: ${n} hand-picked gift idea${n === 1 ? "" : "s"}${top.length ? `, like ${joinNames(top)}` : ""}. Shop each one from Louisiana Helpr.`;
}

/**
 * One gift guide's head. A guide search engines see (in GIFT_GUIDE_SEO, generated with the sitemap's list) gets its
 * unique name ("Gifts for Mom", "Walmart gift guide") as title and card, never a price; any other guide (empty, a hub,
 * a thin store page) is noindex under its own title. `topNames` and `count` (its picks' first names and how many it
 * holds) give it its own description; without them, the template.
 */
/**
 * The picks a guide's description names when it has its own (guide audit 1123 #7): Her, Him and Kids list low to high,
 * so their first three were the cheapest filler ("Colgate Minecraft Kids Toothbrush ...") under every shared link.
 * These are gifts from the owner's own covers (scripts/gift-guide-cover-pins.json) and Top 10; the guard checks each
 * name is still a pick on its guide (src/test/guideAuditFixes1123.test.tsx).
 */
export const GUIDE_LEAD_PICKS = {
  her: ["Therabody Theragun Mini", "Lola Blankets Original Throw Blanket", "Ember Mug 2, Brown"],
  him: ["YETI Rambler 20 oz Tumbler", "XTRATUF Ankle Deck Boot", "BURLEBO Cap"],
  kids: ["Nintendo Switch 2", "Tickle Me Elmo Giggle Max", "Toniebox 2, Sky Blue"],
};

export function giftGuidePageMeta(slug, fallbackTitle = "", topNames = [], count = 0) {
  const day = dealDay(slug);
  if (day) return dealDayPageMeta(day);
  if (slug === SPONSORS_SLUG) return SPONSORS_META;
  const named = Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, slug) ? GIFT_GUIDE_SEO[slug] : null;
  const name = named ?? `${fallbackTitle} gift guide`;
  const lead = Object.prototype.hasOwnProperty.call(GUIDE_LEAD_PICKS, slug) ? GUIDE_LEAD_PICKS[slug] : null;
  // Google search setup (owner 11-23): Her, Him and Kids get their keyword title and a description of at most 155
  // characters (src/content/guideSearch.mjs); og:title (the Facebook headline) stays as it was.
  const search = named && Object.prototype.hasOwnProperty.call(GUIDE_SEARCH, slug) ? GUIDE_SEARCH[slug] : null;
  const first = (lead ?? topNames)[0];
  const description =
    (search ? guideSearchDescription(slug, count, first ? shortName(first) : "") : null) ??
    giftGuideDescription(name, lead ?? topNames, count) ??`${name}: hand-picked holiday gift ideas from Louisiana Helpr, with a link to shop each one.`;
  return {
    title: search ? search.title : `${name} — Helpr`,
    description,
    canonical: `${SITE_ORIGIN}/gift-guides/${slug}`,
    // A name that already says "gift guide" (Monster Jam, owner 11-24) never says it twice on the card.
    ogTitle: /gift guide$/i.test(name) ? `${name} 2026` : `${name}: holiday gift guide 2026`,
    ogDescription: description,
    ...(named ? {} : { robots: NOINDEX_ROBOTS }),
  };
}

/**
 * The 25 Days sponsors page's own head (holiday audit 1121 #75): it read "25 Days Sponsors gift guide", its card said
 * "gift guide" twice ("...gift guide: holiday gift guide 2026") and "hand-picked gift ideas", but these are the brands
 * giving away prizes in our 25 Days of Giveaways, not picks of ours. Still indexed (GIFT_GUIDE_SEO keeps the slug).
 */
const SPONSORS_SLUG = "25-days-sponsors";
const SPONSORS_NAME = "Shop our 25 Days of Giveaways sponsors";
const SPONSORS_DESCRIPTION = "The Louisiana and national brands giving away prizes in our 25 Days of Giveaways, with a gift from each one to shop.";
const SPONSORS_META = {
  title: `${SPONSORS_NAME} — Helpr`,
  description: SPONSORS_DESCRIPTION,
  canonical: `${SITE_ORIGIN}/gift-guides/${SPONSORS_SLUG}`,
  ogTitle: SPONSORS_NAME,
  ogDescription: SPONSORS_DESCRIPTION,
};

/**
 * A deals day's head (owner 2026-11-21: "each day has its own section"): /gift-guides/black-friday,
 * /gift-guides/small-business-saturday and /gift-guides/cyber-monday, each indexed under its own banner title and its
 * own description (giftGuideDeals.mjs DEAL_EVENTS). No catalog guide, so not in GIFT_GUIDE_SEO.
 */
export function dealDayPageMeta(day) {
  const title = Object.prototype.hasOwnProperty.call(DEAL_DAY_SEARCH_TITLES, day.id) ? DEAL_DAY_SEARCH_TITLES[day.id] : `${day.pageTitle} — Helpr`;
  return { title, description: day.description, canonical: `${SITE_ORIGIN}/gift-guides/${day.id}`, ogTitle: day.pageTitle, ogDescription: day.description };
}

/** publicPageMetaFor plus the indexed gift guides (api/share.ts's pre-JS head and route table). */
export function publicOrGiftGuidePageMetaFor(pathname, tabParam) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const gift = path.match(/^\/gift-guides\/([a-z0-9-]+)$/)?.[1];
  if (gift && Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, gift)) return giftGuidePageMeta(gift);
  if (gift && dealDay(gift)) return dealDayPageMeta(dealDay(gift));
  // The fun pages (owner 2026-11-20: swipe, planner, the Secret Santa drawer) are public pages of their own.
  if (gift && Object.prototype.hasOwnProperty.call(PUBLIC_PAGE_META, path)) return PUBLIC_PAGE_META[path];
  // Any other /gift-guides/<slug> (a store page the link audits emptied, a hub, a mistyped slug) is noindex before JS
  // (gg-r3 UX audit #12: the emptied store pages answered "index, follow" with the generic card).
  if (gift) {
    const description = "Hand-picked holiday gift ideas from Louisiana Helpr, with a link to shop each one.";
    return { title: "Holiday gift guides — Helpr", description, canonical: `${SITE_ORIGIN}/gift-guides`, ogTitle: "Holiday gift guides 2026", ogDescription: description, robots: NOINDEX_ROBOTS };
  }
  return publicPageMetaFor(pathname, tabParam);
}
