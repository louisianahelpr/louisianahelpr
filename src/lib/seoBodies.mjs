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

const HOME = { name: "Louisiana Helpr", path: "/" };
const GUIDES = { name: "Holiday Gift Guides", path: "/gift-guides" };

/* ------------------------------------------------------------------ *
 * Gift guides
 * ------------------------------------------------------------------ */

/**
 * /gift-guides/<slug>: breadcrumb, H1 (the guide's name), an intro, and the picks as a numbered list, each its name
 * as a plain link to the shop (an affiliate link, so rel="sponsored nofollow") and the store it is on.
 * `guide` is one SEO_DATA.guides entry: { name, picks: [name, store, href][], related?: [slug, name][] }.
 */
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
  const intro = count
    ? `${count} hand-picked holiday gift idea${count === 1 ? "" : "s"} from Louisiana Helpr, each with a link to the store that sells it. Prices change, so check the store for today's price.`
    : "Picks for this guide are coming soon. Browse every Louisiana Helpr gift guide in the meantime.";
  const related = (guide.related ?? []).map(([s, n]) => `<li><a href="/gift-guides/${escapeHtml(s)}">${escapeHtml(n)}</a></li>`).join("");
  return page(
    crumbs,
    `<h1>${escapeHtml(guide.name)}</h1><p>${escapeHtml(intro)}</p>` +
      (items ? `<ol>${items}</ol>` : "") +
      (related ? `<h2>More gift guides</h2><ul>${related}</ul>` : "") +
      `<p><a href="/gift-guides">All holiday gift guides</a></p>` +
      `<p>Louisiana Helpr earns a commission from qualifying purchases made through these links.</p>`,
  );
}

/**
 * /gift-guides/black-friday-cyber-monday (owner 2026-11-19): the deals guide is no catalog guide (its deals load in the
 * page), so its body is the breadcrumb, its H1 (the day's name), its intro and the disclosure.
 */
export function dealsGuideBody(slug, name, intro, disclosure) {
  return page(
    [HOME, GUIDES, { name, path: `/gift-guides/${slug}` }],
    `<h1>${escapeHtml(name)}</h1><p>${escapeHtml(intro)}</p><p>${escapeHtml(disclosure)}</p><p><a href="/gift-guides">All holiday gift guides</a></p>`,
  );
}

/** ItemList JSON-LD for a guide: each pick's name and shop URL (no Product offers: prices change daily). */
export function giftGuideItemListLd(slug, guide) {
  const picks = (Array.isArray(guide.picks) ? guide.picks : []).filter((p) => safeHref(p[2]));
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: guide.name,
    url: `${SEO_SITE_ORIGIN}/gift-guides/${slug}`,
    numberOfItems: picks.length,
    itemListElement: picks.map(([name, , href], i) => ({ "@type": "ListItem", position: i + 1, name, url: href })),
  };
}

/** /gift-guides: every guide as a plain link, grouped as the page groups them. `groups` is SEO_DATA.groups. */
export function giftGuidesLandingBody(groups) {
  const sections = (groups ?? [])
    .map(([label, guides]) => `<h2>${escapeHtml(label)}</h2><ul>${guides.map(([s, n]) => `<li><a href="/gift-guides/${escapeHtml(s)}">${escapeHtml(n)}</a></li>`).join("")}</ul>`)
    .join("");
  return page(
    [HOME, GUIDES],
    `<h1>Holiday Gift Guides 2026</h1><p>Gift ideas for everyone on your list from Louisiana Helpr: by person, budget, career and store, plus Louisiana favorites. Each guide links to the store that sells every pick.</p>${sections}`,
  );
}

/** ItemList JSON-LD for /gift-guides: the guides' own URLs. */
export function giftGuidesLandingLd(groups) {
  const all = (groups ?? []).flatMap(([, guides]) => guides);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Holiday Gift Guides 2026",
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
    description:
      "Every day from December 1 to 25, 2026, Louisiana Helpr gives away a gift from a Louisiana business. Free to enter.",
    startDate: TWENTY_FIVE_DAYS.startDate,
    endDate: TWENTY_FIVE_DAYS.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: { "@type": "VirtualLocation", url: `${SEO_SITE_ORIGIN}/25days` },
    image: [`${SEO_SITE_ORIGIN}/og-25days.png`],
    isAccessibleForFree: true,
    organizer: { "@type": "Organization", name: "Louisiana Helpr", url: SEO_SITE_ORIGIN },
  };
}

/** The main info pages: H1, intro, and the links a reader needs. Keyed by path. */
const INFO_PAGES = {
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
      "Every day from December 1 to December 25, 2026, Louisiana Helpr gives away a gift from a Louisiana business. It is free to enter. Louisiana businesses can join as a partner and put their brand in front of Louisiana families this holiday season.",
    links: [["/gift-guides", "Holiday gift guides"], ["/declutter", "Declutter"], ["/browse", "Local jobs"]],
  },
};

/** Paths with an info body (the guard's inventory). */
export const INFO_BODY_PATHS = Object.keys(INFO_PAGES).filter((p) => INFO_PAGES[p]);

export function infoPageBody(path) {
  const p = Object.prototype.hasOwnProperty.call(INFO_PAGES, path) ? INFO_PAGES[path] : null;
  if (!p) return null;
  const links = p.links.map(([href, label]) => `<li><a href="${escapeHtml(href)}">${escapeHtml(label)}</a></li>`).join("");
  return page([HOME, { name: p.name, path }], `<h1>${escapeHtml(p.h1)}</h1><p>${escapeHtml(p.intro)}</p><ul>${links}</ul>`);
}

export function infoPageBreadcrumbLd(path) {
  const p = Object.prototype.hasOwnProperty.call(INFO_PAGES, path) ? INFO_PAGES[path] : null;
  return p ? breadcrumbLd([HOME, { name: p.name, path }]) : null;
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
