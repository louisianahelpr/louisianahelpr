/**
 * The gift guides' head values, /gift-guides/<slug> (follow-up batch 2026-11-18, SEO), kept OUT of publicPageMeta.mjs
 * on purpose: GIFT_GUIDE_SEO (every indexed guide's name, ~5 KB gzip) would otherwise ride in the shared chunk every
 * page that imports publicPageMeta loads cold (Login, Signup, Index, the Declutter item page: Q178 critical path). Only
 * the gift guides page (GiftGuides.tsx) and api/share.ts import this module. Types: giftGuidePageMeta.d.mts.
 */

import { SITE_ORIGIN, NOINDEX_ROBOTS, publicPageMetaFor } from "./publicPageMeta.mjs";
import { GIFT_GUIDE_SEO } from "../content/giftGuideSeo.mjs";

/**
 * One gift guide's head. A guide search engines see (in GIFT_GUIDE_SEO, generated with the sitemap's list) gets its
 * unique name ("Gifts for Mom", "Walmart gift guide") as title and card, never a price; any other guide (empty, a hub,
 * a thin store page) is noindex under its own title.
 */
export function giftGuidePageMeta(slug, fallbackTitle = "") {
  const named = Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, slug) ? GIFT_GUIDE_SEO[slug] : null;
  const name = named ?? `${fallbackTitle} gift guide`;
  const description = `${name}: hand-picked holiday gift ideas from Louisiana Helpr, with a link to shop each one.`;
  return {
    title: `${name} — Helpr`,
    description,
    canonical: `${SITE_ORIGIN}/gift-guides/${slug}`,
    ogTitle: `${name}: holiday gift guide 2026`,
    ogDescription: description,
    ...(named ? {} : { robots: NOINDEX_ROBOTS }),
  };
}

/** publicPageMetaFor plus the indexed gift guides (api/share.ts's pre-JS head and route table). */
export function publicOrGiftGuidePageMetaFor(pathname, tabParam) {
  const path = pathname.replace(/\/+$/, "") || "/";
  const gift = path.match(/^\/gift-guides\/([a-z0-9-]+)$/)?.[1];
  if (gift && Object.prototype.hasOwnProperty.call(GIFT_GUIDE_SEO, gift)) return giftGuidePageMeta(gift);
  // Any other /gift-guides/<slug> (a store page the link audits emptied, a hub, a mistyped slug) is noindex before JS
  // (gg-r3 UX audit #12: the emptied store pages answered "index, follow" with the generic card).
  if (gift) {
    const description = "Hand-picked holiday gift ideas from Louisiana Helpr, with a link to shop each one.";
    return { title: "Gift guides — Helpr", description, canonical: `${SITE_ORIGIN}/gift-guides`, ogTitle: "Holiday gift guides 2026", ogDescription: description, robots: NOINDEX_ROBOTS };
  }
  return publicPageMetaFor(pathname, tabParam);
}
