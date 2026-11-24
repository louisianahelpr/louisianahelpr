/**
 * SEO P1 (owner 11-19: "a lot of google work we need to show up for every search louisiana Helpr relates to"):
 * the per-page body a reader with no JavaScript sees inside #root, and each page's JSON-LD.
 *
 * Before this, every URL api/share.ts served carried the homepage's body (the landing shell's H1, text and links);
 * only the head differed, so Google indexed the homepage alone (audit 11-18, ~/Desktop/SEO-plan-1119.md). Each body
 * here is plain semantic HTML (breadcrumb links, one <h1>, an intro, the guide's picks or the page's links), built
 * from the same tables the app reads (townPages.mjs, the gift guide catalog through scripts/generated/seo-data.js).
 * Every visitor gets the same document: this is not cloaking. React's createRoot replaces #root's children on its
 * first render, as it already does for /terms/full (staticPages.tsx).
 *
 * Plain dependency-free ESM: api/share.ts imports it (no Vite there). Types: seoBodies.d.mts.
 * Guard: src/test/seoPageBodies.test.ts.
 */

import { TOWN_PAGE_SERVICES, TOWN_PAGE_TOWNS, townPagePath } from "./townPages.mjs";
import { pickPriceShown, shownDollars } from "./pickPriceShown.mjs";
import { DEALS_WORDS, dealName, dealShows } from "../content/giftGuideDeals.mjs";
import { SMALL_BIZ_WORDS, smallBizSections } from "../content/giftGuideSmallBiz.mjs";
import { GUIDE_CROSS_LINKS, GUIDE_SEARCH } from "../content/guideSearch.mjs";
import { isLiveGuide } from "../content/giftGuideLive.mjs";

export const SEO_SITE_ORIGIN = "https://www.louisianahelpr.com";

/** Text and attribute escaping (every value may come from a content file). */
export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** An outbound link we may write: https only (a content typo never becomes a javascript: link). */
function safeHref(href) {
  return typeof href === "string" && /^https:\/\/[^\s"'<>]+$/.test(href) ? href : null;
}

/** One <script type="application/ld+json">, with "<" escaped so no value can close the tag. */
export function jsonLdScript(data) {
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

/** BreadcrumbList for [{ name, path }] (path root-relative). */
export function breadcrumbLd(crumbs) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: `${SEO_SITE_ORIGIN}${c.path}` })),
  };
}

function breadcrumbNav(crumbs) {
  const parts = crumbs.map((c, i) =>
    i === crumbs.length - 1 ? `<span aria-current="page">${escapeHtml(c.name)}</span>` : `<a href="${escapeHtml(c.path)}">${escapeHtml(c.name)}</a>`,
  );
  return `<nav aria-label="Breadcrumb"><p>${parts.join(" › ")}</p></nav>`;
}

/** The wrapper every body shares: one <main>, the breadcrumb, then the page. */
function page(crumbs, inner) {
  return `<main id="seo-page" data-seo-body="">${breadcrumbNav(crumbs)}${inner}</main>`;
}

/** The same wrapper for another module's page (the Holiday Hub, src/lib/holidayHubSeo.mjs). */
export function seoPageBody(crumbs, inner) {
  return page(crumbs, inner);
}

const HOME = { name: "Louisiana Helpr", path: "/" };
const GUIDES = { name: "Holiday gift guides", path: "/gift-guides" };

/* ------------------------------------------------------------------ *
 * Gift guides
 * ------------------------------------------------------------------ */

/**
 * /gift-guides/<slug>: breadcrumb, H1 (the guide's name), an intro, and the picks as a numbered list, each its name
 * as a plain link to the shop (an affiliate link, so rel="sponsored nofollow") and the store it is on.
 * `guide` is one SEO_DATA.guides entry: { name, picks: [name, store, href][], related?: [slug, name][] }.
 */
/** A searchable guide's visible intro (Her, Him, Kids: src/content/guideSearch.mjs), else null. */
const searchIntro = (slug) => (Object.prototype.hasOwnProperty.call(GUIDE_SEARCH, slug) ? GUIDE_SEARCH[slug].intro : null);

/**
 * Google search setup (owner 11-23; live audit: Her linked only Him, Kids and the deals days linked no other guide):
 * the main guides and live deals days, each page leaving itself out, as plain links.
 */
function crossLinks(slug) {
  const rows = GUIDE_CROSS_LINKS.filter(([s]) => s !== slug && isLiveGuide(s));
  return rows.length ? `<h2>Gift guides and deals</h2><ul>${rows.map(([s, n]) => `<li><a href="/gift-guides/${escapeHtml(s)}">${escapeHtml(n)}</a></li>`).join("")}</ul>` : "";
}

export function giftGuideBody(slug, guide) {
  const crumbs = [HOME, GUIDES, { name: guide.name, path: `/gift-guides/${slug}` }];
  const picks = Array.isArray(guide.picks) ? guide.picks : [];
  const count = Math.max(Number(guide.count) || 0, picks.length);
  const items = picks
    .map(([name, store, href]) => {
      const link = safeHref(href);
      const label = escapeHtml(name);
      const where = store ? ` <span>on ${escapeHtml(store)}</span>` : "";
      return `<li>${link ? `<a href="${escapeHtml(link)}" rel="sponsored nofollow noopener" target="_blank">${label}</a>` : label}${where}</li>`;
    })
    .join("");
  const countLine = count
    ? `${count} hand-picked holiday gift idea${count === 1 ? "" : "s"} from Louisiana Helpr, each with a link to the store that sells it. Prices change, so check the store for today's price.`
    : "Picks for this guide are coming soon. Browse every Louisiana Helpr gift guide in the meantime.";
  const intro = searchIntro(slug) ?? "";
  // A cross-link already says it: "More gift guides" keeps only the guides the cross-links leave out.
  const linked = new Set(GUIDE_CROSS_LINKS.map(([s]) => s));
  const related = (guide.related ?? []).filter(([s]) => !linked.has(s)).map(([s, n]) => `<li><a href="/gift-guides/${escapeHtml(s)}">${escapeHtml(n)}</a></li>`).join("");
  return page(
    crumbs,
    `<h1>${escapeHtml(guide.name)}</h1>${intro ? `<p>${escapeHtml(intro)}</p>` : ""}<p>${escapeHtml(countLine)}</p>` +
      (items ? `<ol>${items}</ol>` : "") +
      crossLinks(slug) +
      (related ? `<h2>More gift guides</h2><ul>${related}</ul>` : "") +
      `<p><a href="/gift-guides">All holiday gift guides</a></p>` +
      `<p>Louisiana Helpr earns a commission from qualifying purchases made through these links.</p>`,
  );
}

/** A row's "Deal (Ends Nov 30)" words: the card's own dates line (DEALS_WORDS.runs), never an invented day. */
function runsText(starts, ends) {
  return DEALS_WORDS.runs(starts || null, ends || null);
}

const outLink = (href, label, rel) => {
  const link = safeHref(href);
  return link ? `<a href="${escapeHtml(link)}" rel="${rel}" target="_blank">${escapeHtml(label)}</a>` : escapeHtml(label);
};
const SPONSORED = "sponsored nofollow noopener";

/**
 * What a deals day page shows on `today` (seo bodies 1123, technical SEO audit TS3), from the build's rows
 * (src/prerender/seoData.ts): its Top deals cards still showing (dealShows, the page's rule: through the card's last
 * day, or through Dec 1 when it has none), and its Discount codes and Sales rows for the day (the last dealLists row
 * starting on or before `today`, as guideQa.mjs dealPartsOn reads the counts).
 */
export function dealsDayOn(data, slug, today) {
  const deals = (Array.isArray(data?.deals) ? data.deals : []).filter(
    ([item, href, ends, event]) => event === slug && item && safeHref(href) && dealShows({ ends: ends || undefined }, today),
  );
  const lists = data?.dealLists?.[slug];
  let at = null;
  for (const r of Array.isArray(lists?.rows) ? lists.rows : []) if (Array.isArray(r) && r[0] <= today) at = r;
  const codes = at ? at[1].map((i) => lists.codes[i]).filter((c) => c && safeHref(c[4])) : [];
  const sales = at ? at[2].map((i) => lists.sales[i]).filter((s) => s && safeHref(s[2])) : [];
  return { deals, codes, sales };
}

/** Rows grouped by their first field (the store), in first-appearance order, as the page draws one card per store. */
function byStore(rows) {
  const out = new Map();
  for (const r of rows) out.set(r[0], [...(out.get(r[0]) ?? []), r]);
  return [...out.entries()];
}

/**
 * A deals day, /gift-guides/black-friday, /small-business-saturday or /cyber-monday (owner 2026-11-19; one page per day
 * owner 2026-11-21): no catalog guide (its cards load in the page), so its body is the breadcrumb, its H1 (the day's
 * name), its intro and one more line (the disclosure, or the day line on Small Business Saturday).
 * Seo bodies 1123 (technical SEO audit TS3: AI assistants, which run no JavaScript, saw none of the day's 61 deals):
 * then the page's own sections, in its order and with its headings. A deals day (`day`, dealsDayOn): Top deals (one row
 * per card: its name, its deal and when it runs), Discount codes (one row per store, its best code first, as the code
 * cards) and Sales (one row per store, each sale its own link). Small Business Saturday (`shops`): every business
 * under its category (smallBizSections), its name linking where its card does, its town, and its gift idea.
 */
export function dealsGuideBody(slug, name, intro, disclosure, day, shops) {
  let lists = "";
  if (day) {
    const top = day.deals
      .map(([item, href, ends, , brand, deal, starts]) => {
        const words = [deal, runsText(starts, ends)].filter(Boolean).join(" · ");
        return `<li>${outLink(href, brand ? dealName({ brand, item, deal: deal ?? "" }) : item, SPONSORED)}${words ? ` <span>${escapeHtml(words)}</span>` : ""}</li>`;
      })
      .join("");
    const codes = byStore(day.codes)
      .map(([store, rows]) => `<li>${outLink(rows[0][4], store, SPONSORED)}: ${rows.map(([, code, offer, runs]) => `${escapeHtml([offer, runs].filter(Boolean).join(" · "))}${code ? ` (code <code>${escapeHtml(code)}</code>)` : ""}`).join("; ")}</li>`)
      .join("");
    const sales = byStore(day.sales)
      .map(([store, rows]) => `<li>${escapeHtml(store)}: ${rows.map(([, offer, href, ends]) => `${outLink(href, offer, SPONSORED)}${ends ? ` <span>${escapeHtml(runsText(null, ends))}</span>` : ""}`).join("; ")}</li>`)
      .join("");
    lists =
      (top ? `<h2>Top deals</h2><ul>${top}</ul>` : "") +
      (codes ? `<h2>Discount codes</h2><ul>${codes}</ul>` : "") +
      (sales ? `<h2>Sales</h2><ul>${sales}</ul>` : "") +
      (top || codes || sales ? "" : `<p>${escapeHtml(DEALS_WORDS.none)}</p>`);
  }
  if (Array.isArray(shops) && shops.length) {
    const rows = shops.filter((s) => s && s[0]).map(([name, town, category, ships, href, gift]) => ({ name, town, category, ships, href, gift }));
    lists += smallBizSections(rows)
      .map(
        (s) =>
          `<h2>${escapeHtml(s.category)}</h2><ul>${s.rows
            .map((b) => {
              const where = [b.town || "Louisiana", b.ships === "ships" ? SMALL_BIZ_WORDS.ships : SMALL_BIZ_WORDS.local].join(" · ");
              return `<li>${outLink(b.href, b.name, "noopener noreferrer")} <span>${escapeHtml(where)}</span>${b.gift ? ` <span>${escapeHtml(`${SMALL_BIZ_WORDS.giftLabel} ${b.gift}`)}</span>` : ""}</li>`;
            })
            .join("")}</ul>`,
      )
      .join("");
  }
  return page(
    [HOME, GUIDES, { name, path: `/gift-guides/${slug}` }],
    `<h1>${escapeHtml(name)}</h1><p>${escapeHtml(intro)}</p>${lists}<p>${escapeHtml(disclosure)}</p>${crossLinks(slug)}<p><a href="/gift-guides">All holiday gift guides</a></p>`,
  );
}

/** A photo URL a Product may carry: https, or a site path made absolute. */
function productImage(src) {
  if (typeof src !== "string") return null;
  if (/^\/[^/\s"'<>][^\s"'<>]*$/.test(src)) return `${SEO_SITE_ORIGIN}${src}`;
  return safeHref(src);
}

/**
 * ItemList JSON-LD for a guide (structured data, lead 11-21). A pick whose card shows a price on `today` (the shared
 * rule, pickPriceShown.mjs) is a schema.org Product with its photo and one Offer at the dollars the card shows; any
 * other pick stays a plain ListItem (name and shop link), because a Product with no offers, review or rating is an
 * error in Google's Product rules. Only visible data: no availability (we show none), no rating, no review, ever.
 * Note (Google, 11-21): list pages of other stores' links are not eligible for US product rich results (the product
 * carousel is EEA/Türkiye/South Africa and same-domain only); the markup is still valid for other readers.
 */
export function giftGuideItemListLd(slug, guide, today) {
  const picks = (Array.isArray(guide.picks) ? guide.picks : []).filter((p) => safeHref(p[2]));
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: guide.name,
    url: `${SEO_SITE_ORIGIN}/gift-guides/${slug}`,
    numberOfItems: picks.length,
    itemListElement: picks.map(([name, , href, extra], i) => {
      const x = extra && typeof extra === "object" ? extra : {};
      const image = productImage(x.image);
      // Google search setup 11-23: a plain row carries its photo too (schema.org Thing.image), never a price.
      if (!pickPriceShown(x.price, x.priceAt, today)) return { "@type": "ListItem", position: i + 1, name, url: href, ...(image ? { image } : {}) };
      return {
        "@type": "ListItem",
        position: i + 1,
        item: {
          "@type": "Product",
          name,
          url: href,
          ...(image ? { image } : {}),
          offers: { "@type": "Offer", price: shownDollars(x.price), priceCurrency: "USD", url: href },
        },
      };
    }),
  };
}

/**
 * ItemList JSON-LD for one deals day page (`slug`): each of its cards showing on `today`, name and shop link. Seo bodies
 * 1123 (technical SEO audit TS2): a card shows by the page's rule (dealShows: through its last day, or through Dec 1 when
 * it has none), so an undated card leaves the markup the day it leaves the page. With `day` (dealsDayOn), the list is
 * every card the body lists, as the page names them: the Top deals, then one per Discount codes store ("Store: best
 * offer"), then one per Sales store ("Store: first sale"). No price: the cards show none.
 */
export function dealsItemListLd(name, deals, today, slug, day) {
  const live = day ? day.deals : dealsDayOn({ deals }, slug, today).deals;
  const items = [
    ...live.map(([item, href, , , brand, deal]) => ({ name: brand ? dealName({ brand, item, deal: deal ?? "" }) : item, url: href })),
    ...(day ? byStore(day.codes).map(([store, rows]) => ({ name: `${store}: ${rows[0][2]}`, url: rows[0][4] })) : []),
    ...(day ? byStore(day.sales).map(([store, rows]) => ({ name: `${store}: ${rows[0][1]}`, url: rows[0][2] })) : []),
  ];
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name,
    url: `${SEO_SITE_ORIGIN}/gift-guides/${slug}`,
    numberOfItems: items.length,
    itemListElement: items.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, url: x.url })),
  };
}

/** /gift-guides: every guide as a plain link, grouped as the page groups them. `groups` is SEO_DATA.groups. */
export function giftGuidesLandingBody(groups) {
  const sections = (groups ?? [])
    .map(([label, guides]) => `<h2>${escapeHtml(label)}</h2><ul>${guides.map(([s, n]) => `<li><a href="/gift-guides/${escapeHtml(s)}">${escapeHtml(n)}</a></li>`).join("")}</ul>`)
    .join("");
  return page(
    [HOME, GUIDES],
    `<h1>Holiday gift guides 2026</h1><p>Christmas gift ideas for her, him and the kids from Louisiana Helpr, from stocking stuffers under $10 to gifts under $25 and $50, with Louisiana gifts mixed in. Every pick shows its price, and each guide links to the store that sells every pick.</p>${sections}${crossLinks("")}`,
  );
}

/** ItemList JSON-LD for /gift-guides: the guides' own URLs. */
export function giftGuidesLandingLd(groups) {
  const all = (groups ?? []).flatMap(([, guides]) => guides);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Holiday gift guides 2026",
    url: `${SEO_SITE_ORIGIN}/gift-guides`,
    numberOfItems: all.length,
    itemListElement: all.map(([s, n], i) => ({ "@type": "ListItem", position: i + 1, name: n, url: `${SEO_SITE_ORIGIN}/gift-guides/${s}` })),
  };
}

/* ------------------------------------------------------------------ *
 * Hire pages (/hire/<service>/<town>)
 * ------------------------------------------------------------------ */

export function hireBody(service, town) {
  const label = service.pageLabel ?? service.label;
  const path = townPagePath(service, town);
  const crumbs = [HOME, { name: `${label} in ${town.name}`, path }];
  const otherTowns = TOWN_PAGE_TOWNS.filter((t) => t.slug !== town.slug)
    .map((t) => `<li><a href="${townPagePath(service, t)}">${escapeHtml(`${label} in ${t.name}`)}</a></li>`)
    .join("");
  const otherServices = TOWN_PAGE_SERVICES.filter((s) => s.slug !== service.slug)
    .map((s) => `<li><a href="${townPagePath(s, town)}">${escapeHtml(`${s.pageLabel ?? s.label} in ${town.name}`)}</a></li>`)
    .join("");
  return page(
    crumbs,
    `<h1>${escapeHtml(`${label} in ${town.name}, LA`)}</h1>` +
      `<p>${escapeHtml(`Need ${service.phrase} in ${town.name}? Post the job on Louisiana Helpr and name your price. Local Helprs near ${town.name} apply, you pick the one you want, and your payment is held safely until the work is done.`)}</p>` +
      `<h2>How it works</h2><ol><li>Post your job for free and set your price.</li><li>Local Helprs apply; read their reviews and pick one.</li><li>Your payment is held until the job is done, then released.</li></ol>` +
      `<p><a href="/browse">See open jobs near you</a></p>` +
      `<h2>${escapeHtml(`${label} in other Louisiana towns`)}</h2><ul>${otherTowns}</ul>` +
      `<h2>${escapeHtml(`More help in ${town.name}`)}</h2><ul>${otherServices}</ul>`,
  );
}

export function hireBreadcrumbLd(service, town) {
  const label = service.pageLabel ?? service.label;
  return breadcrumbLd([HOME, { name: `${label} in ${town.name}`, path: townPagePath(service, town) }]);
}

/* ------------------------------------------------------------------ *
 * Info pages
 * ------------------------------------------------------------------ */

/** 25 Days: the public dates only (owner rule 11-17: never a sponsor's day until the lineup is final). */
export const TWENTY_FIVE_DAYS = { name: "25 Days of Louisiana Giveaways", startDate: "2026-12-01", endDate: "2026-12-25" };

export function twentyFiveDaysEventLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: TWENTY_FIVE_DAYS.name,
    // Technical SEO audit TS10 (1123): gifts from Louisiana businesses and national brands (the sponsors page lists both,
    // and some days have several winners); the organizer is the homepage's Organization node (index.html @id).
    description:
      "Every day from December 1 to 25, 2026, Louisiana Helpr gives away gifts from Louisiana businesses and national brands. Free to enter.",
    startDate: TWENTY_FIVE_DAYS.startDate,
    endDate: TWENTY_FIVE_DAYS.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: { "@type": "VirtualLocation", url: `${SEO_SITE_ORIGIN}/25days` },
    image: [`${SEO_SITE_ORIGIN}/og-25days-enter.png`],
    isAccessibleForFree: true,
    organizer: { "@type": "Organization", "@id": `${SEO_SITE_ORIGIN}/#organization`, name: "Louisiana Helpr", url: SEO_SITE_ORIGIN },
  };
}

/** The main info pages: H1, intro, and the links a reader needs. Keyed by path. */
const INFO_PAGES = {
  // Gift guides fun features (owner 2026-11-20): one-segment pages under /gift-guides that are no guide.
  "/gift-guides/swipe": {
    name: "Swipe to find gifts",
    h1: "Swipe to find gifts",
    intro: "Pick who it's for and your budget, then swipe through gift ideas from our holiday gift guides. Swipe right to save a gift to your gift planner.",
    links: [["/gift-guides", "Holiday gift guides"], ["/gift-guides/planner", "Gift planner"], ["/gift-guides/draw-names", "Secret Santa name draw"]],
  },
  "/gift-guides/planner": {
    name: "Gift planner",
    h1: "Holiday gift planner and budget",
    intro: "List who you're shopping for, set a budget for each person, add gift ideas and mark what you've bought. Your planner stays private.",
    links: [["/gift-guides", "Holiday gift guides"], ["/gift-guides/swipe", "Swipe to find gifts"]],
  },
  "/gift-guides/draw-names": {
    name: "Secret Santa name draw",
    h1: "Free Secret Santa name draw",
    intro: "Type everyone's first name, add a budget and who can't draw each other, and send each person a private link to their match. No emails or phone numbers.",
    // Technical SEO audit TS5 (1123): live pages only (the Secret Santa guide is retired and 301s to /gift-guides).
    links: [["/gift-guides/planner", "Gift planner"], ["/gift-guides/swipe", "Swipe to find gifts"], ["/gift-guides", "Holiday gift guides"]],
  },
  "/gift-guides/printables": {
    name: "Free printables",
    h1: "Free holiday printables",
    intro: "Christmas gift tags with names (pick a design, type the To and From names, print a sheet of 9 or 10 with cut lines), two Christmas coloring books, and Happy Thanksgiving and Merry Christmas banners. Free, with no sign-up, and nothing is saved.",
    links: [["/gift-guides/printables/gift-tags", "Free gift tags"], ["/gift-guides/printables/coloring-books", "Free coloring books"], ["/gift-guides/printables/banners", "Free banners"], ["/gift-guides", "Holiday gift guides"]],
  },
  "/gift-guides/printables/gift-tags": {
    name: "Free gift tags",
    h1: "Free printable Christmas gift tags",
    intro: "Pick a design, type the To and From names, and print a sheet of 9 or 10 tags with cut lines at home. Free, with no sign-up, and nothing is saved.",
    links: [["/gift-guides/printables/coloring-books", "Free coloring books"], ["/gift-guides/printables/banners", "Free banners"], ["/gift-guides", "Holiday gift guides"]],
  },
  "/gift-guides/printables/coloring-books": {
    name: "Free coloring books",
    h1: "Free printable Christmas coloring books",
    intro: "Two Christmas coloring books, a girls' book and a boys' book, each a cover and 20 simple pages to color. Print at home, free, with no sign-up.",
    links: [["/gift-guides/printables/gift-tags", "Free gift tags"], ["/gift-guides/printables/banners", "Free banners"], ["/gift-guides", "Holiday gift guides"]],
  },
  "/gift-guides/printables/banners": {
    name: "Free banners",
    h1: "Free printable holiday banners",
    intro: "Four free banners, Happy Thanksgiving and three Merry Christmas designs, each ready to print as a 12x18 poster at Walgreens (from about $13, same-day pickup) or any photo counter. The original wide files are there too. No sign-up.",
    links: [["/gift-guides/printables/gift-tags", "Free gift tags"], ["/gift-guides/printables/coloring-books", "Free coloring books"], ["/gift-guides", "Holiday gift guides"]],
  },
  "/declutter": {
    name: "Declutter",
    h1: "Declutter: used things for sale near you in Louisiana",
    intro:
      "Furniture, home goods, baby gear and more from your Louisiana neighbors. Look around with no account, then pick it up, meet up, or have a Helpr deliver it. Selling? List your things for free.",
    links: [["/declutter", "Browse things for sale"], ["/declutter/sell", "Sell something"], ["/gift-guides", "Holiday gift guides"], ["/browse", "Local jobs"]],
  },
  "/browse": null,
  "/help": {
    name: "Help center",
    h1: "Louisiana Helpr help center",
    intro: "Answers and guides for posting jobs, doing jobs, buying and selling on Declutter, payments, safety and your account.",
    links: [["/support", "Contact support"], ["/fees", "Fees"], ["/safety", "Safety"], ["/legal", "Terms and policies"]],
  },
  "/support": {
    name: "Contact support",
    h1: "Contact Louisiana Helpr support",
    intro: "Message the Louisiana Helpr team about your account, a job, a payment or a bug. No account needed; we reply by email.",
    links: [["/help", "Help center"], ["/safety", "Safety"]],
  },
  "/fees": {
    name: "Fees",
    h1: "Fees on Louisiana Helpr",
    intro: "Posting a job on Louisiana Helpr is free. A small one-time setup fee applies to your first paid job, and any service fee is shown before you pay. Helprs see their pay before they apply.",
    links: [["/safety", "Safety"], ["/help", "Help center"]],
  },
  "/safety": {
    name: "Safety",
    h1: "Safety on Louisiana Helpr",
    intro: "Your money is held until you approve the work, and a problem can be reported from any job. Here is how Louisiana Helpr keeps members safe.",
    links: [["/fees", "Fees"], ["/help", "Help center"], ["/support", "Contact support"]],
  },
  "/25days": {
    name: TWENTY_FIVE_DAYS.name,
    h1: "25 Days of Louisiana Giveaways: December 1–25, 2026",
    intro:
      "Every day from December 1 to December 25, 2026, Louisiana businesses give away gifts to Louisiana neighbors on Louisiana Helpr. It is free to enter. How to enter and the official rules are on the Louisiana Helpr Facebook post.",
    links: [["/gift-guides/25-days-sponsors", "Gifts from our 25 Days sponsors"], ["/sponsor", "Become a sponsor"], ["/gift-guides", "Holiday gift guides"], ["/declutter", "Declutter"]],
  },
};

/** Info pages under /gift-guides sit under the gift guides in their breadcrumb, as their URL does (technical SEO audit TS15). */
function infoCrumbs(path, name) {
  return path.startsWith("/gift-guides/") ? [HOME, GUIDES, { name, path }] : [HOME, { name, path }];
}

/**
 * /25days's lineup (seo bodies 1123, technical SEO audit TS3): the page's "This year's sponsors" grid as the page draws
 * it (Sections.tsx Lineup, from seo-data's lineup): A to Z, each brand linking to its page when we know it, and its
 * prizes. Never a day (owner 11-17: no sponsor's day until the lineup is final) and never how to enter (owner 11-21: the
 * rules live only on Facebook).
 */
function lineupHtml(lineup) {
  const partners = Array.isArray(lineup?.partners) ? lineup.partners.filter((p) => Array.isArray(p) && p[0]) : [];
  if (partners.length === 0) return "";
  const items = partners
    .map(([brand, prizes, href]) => {
      const gifts = (Array.isArray(prizes) ? prizes : []).filter(Boolean);
      return `<li>${outLink(href, brand, "noopener noreferrer")}${gifts.length ? ` <span>${escapeHtml(gifts.join("; "))}</span>` : ""}</li>`;
    })
    .join("");
  return `<h2>${escapeHtml(lineup.title)}</h2><p>${escapeHtml(lineup.intro)}</p><ul>${items}</ul>`;
}

/** Paths with an info body (the guard's inventory). */
export const INFO_BODY_PATHS = Object.keys(INFO_PAGES).filter((p) => INFO_PAGES[p]);

/** Every link an info page's body carries (the guard checks each one is a live page). */
export const INFO_BODY_LINKS = Object.values(INFO_PAGES).flatMap((p) => (p ? p.links.map(([href]) => href) : []));

/** `lineup`: seo-data's /25days lineup (only /25days draws it). */
export function infoPageBody(path, lineup) {
  const p = Object.prototype.hasOwnProperty.call(INFO_PAGES, path) ? INFO_PAGES[path] : null;
  if (!p) return null;
  const links = p.links.map(([href, label]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join("");
  const extra = path === "/25days" ? lineupHtml(lineup) : "";
  return page(infoCrumbs(path, p.name), `<h1>${escapeHtml(p.h1)}</h1><p>${escapeHtml(p.intro)}</p>${extra}<ul>${links}</ul>`);
}

export function infoPageBreadcrumbLd(path) {
  const p = Object.prototype.hasOwnProperty.call(INFO_PAGES, path) ? INFO_PAGES[path] : null;
  return p ? breadcrumbLd(infoCrumbs(path, p.name)) : null;
}

/* ------------------------------------------------------------------ *
 * Not found
 * ------------------------------------------------------------------ */

/** A 404's body: says so plainly and points somewhere useful (never the homepage's hero). */
export function notFoundBody(kind) {
  const extra =
    kind === "gift-guide"
      ? `<p>That gift guide doesn't exist or has moved. <a href="/gift-guides">See every holiday gift guide</a>.</p>`
      : kind === "hire"
        ? `<p>We don't have that page yet. <a href="/browse">See open jobs near you</a> or <a href="/post-job">post a job</a>.</p>`
        : "";
  return `<main id="seo-page" data-seo-body=""><h1>Page not found</h1><p>Sorry, we couldn't find that page on Louisiana Helpr.</p>${extra}<ul><li><a href="/">Louisiana Helpr home</a></li><li><a href="/gift-guides">Holiday gift guides</a></li><li><a href="/declutter">Declutter</a></li><li><a href="/browse">Local jobs</a></li></ul></main>`;
}
