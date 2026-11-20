/**
 * The gift guides' head values, /gift-guides/<slug> (follow-up batch 2026-11-18, SEO), kept OUT of publicPageMeta.mjs
 * on purpose: GIFT_GUIDE_SEO (every indexed guide's name, ~5 KB gzip) would otherwise ride in the shared chunk every
 * page that imports publicPageMeta loads cold (Login, Signup, Index, the Declutter item page: Q178 critical path). Only
 * the gift guides page (GiftGuides.tsx) and api/share.ts import this module. Types: giftGuidePageMeta.d.mts.
 */

import { SITE_ORIGIN, NOINDEX_ROBOTS, publicPageMetaFor } from "./publicPageMeta.mjs";
import { GIFT_GUIDE_SEO } from "../content/giftGuideSeo.mjs";
import { DEALS_SLUG, dealsTitle, louisianaDay } from "../content/giftGuideDeals.mjs";

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
export function giftGuidePageMeta(slug, fallbackTitle = "", topNames = [], count = 0) {
  if (slug === DEALS_SLUG) return dealsPageMeta(new Date());
  const named = Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, slug) ? GIFT_GUIDE_SEO[slug] : null;
  const name = named ?? `${fallbackTitle} gift guide`;
  const description =
    giftGuideDescription(name, topNames, count) ?? `${name}: hand-picked holiday gift ideas from Louisiana Helpr, with a link to shop each one.`;
  return {
    title: `${name} — Helpr`,
    description,
    canonical: `${SITE_ORIGIN}/gift-guides/${slug}`,
    ogTitle: `${name}: holiday gift guide 2026`,
    ogDescription: description,
    ...(named ? {} : { robots: NOINDEX_ROBOTS }),
  };
}

/**
 * The Black Friday & Cyber Monday deals guide's head (owner 2026-11-19): indexed, named for the day (dealsTitle:
 * "Holiday Deals" after Dec 1). It is no catalog guide, so it is not in GIFT_GUIDE_SEO.
 */
export function dealsPageMeta(now) {
  const name = dealsTitle(louisianaDay(now));
  const description = `${name} 2026: hand-checked sales and codes from brands like Charlotte Tilbury, Stanley, lululemon and Yoto, picked by Louisiana Helpr.`;
  return { title: `${name} — Helpr`, description, canonical: `${SITE_ORIGIN}/gift-guides/${DEALS_SLUG}`, ogTitle: name, ogDescription: description };
}

/** publicPageMetaFor plus the indexed gift guides (api/share.ts's pre-JS head and route table). */
export function publicOrGiftGuidePageMetaFor(pathname, tabParam) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const gift = path.match(/^\/gift-guides\/([a-z0-9-]+)$/)?.[1];
  if (gift && Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, gift)) return giftGuidePageMeta(gift);
  if (gift === DEALS_SLUG) return dealsPageMeta(new Date());
  // Any other /gift-guides/<slug> (a store page the link audits emptied, a hub, a mistyped slug) is noindex before JS
  // (gg-r3 UX audit #12: the emptied store pages answered "index, follow" with the generic card).
  if (gift) {
    const description = "Hand-picked holiday gift ideas from Louisiana Helpr, with a link to shop each one.";
    return { title: "Gift guides — Helpr", description, canonical: `${SITE_ORIGIN}/gift-guides`, ogTitle: "Holiday gift guides 2026", ogDescription: description, robots: NOINDEX_ROBOTS };
  }
  return publicPageMetaFor(pathname, tabParam);
}
