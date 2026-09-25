/**
 * Per-route head metadata for the public, indexable pages — ONE table read by
 * both sides of the page:
 *
 *   - the client, after JavaScript runs (`usePageMeta` in DashboardGuest,
 *     HelpCenter, Support and Legal), and
 *   - `api/share.ts`, which vercel.json routes these paths through so the
 *     pre-JS HTML a crawler or link unfurler reads carries the same title,
 *     description, og:* and a self-referencing canonical (lh-seo-web SW-001 /
 *     SW-002: before this, every one of these routes served the homepage's
 *     values, canonical included, until JS ran).
 *
 * Plain dependency-free ESM on purpose: the serverless function imports it at
 * runtime with no TypeScript step and no path aliases, exactly like the
 * build-time shell snapshot beside it. Types: publicPageMeta.d.mts.
 *
 * The landing page (`/`) is deliberately NOT here: it is served as the static
 * index.html, whose head values are its own and are left as they are.
 *
 * Pinned by src/test/publicRoutesServeOwnHead.test.ts, which walks
 * public/sitemap.xml and exercises the handler for every URL in it.
 */

export const SITE_ORIGIN = "https://www.louisianahelpr.com";

/** @type {readonly ["terms", "community", "privacy"]} */
export const LEGAL_TABS = ["terms", "community", "privacy"];

/**
 * /terms, /privacy and /rules render the Legal page directly (App.tsx) with no
 * ?tab= — the path IS the tab in that case. ?tab= still wins whenever present.
 */
export const LEGAL_PATH_TAB = {
  "/terms": "terms",
  "/privacy": "privacy",
  "/rules": "community",
};

/** Which Legal tab a URL shows. Same resolution the page itself uses. */
export function resolveLegalTab(pathname, tabParam) {
  const wanted = tabParam || LEGAL_PATH_TAB[pathname] || "terms";
  return LEGAL_TABS.includes(wanted) ? wanted : "terms";
}

export const LEGAL_PAGE_META = {
  terms: {
    title: "Terms of Service — Helpr",
    description:
      "Helpr's Terms of Service — eligibility, binding job agreements, escrow, split fees, membership tiers, and tax responsibilities for Louisiana's job marketplace.",
    canonical: `${SITE_ORIGIN}/legal`,
  },
  community: {
    title: "Community Rules — Helpr",
    description:
      "Helpr's Community Rules — cancellation windows, escrow release, the revision-and-dispute process, strikes, bans, and money-and-taxes guidance.",
    canonical: `${SITE_ORIGIN}/legal?tab=community`,
  },
  privacy: {
    title: "Privacy Policy — Helpr",
    description:
      "Helpr's Privacy Policy — what we collect, how we use it, who we share with, data security, and your rights. We never sell your personal data.",
    canonical: `${SITE_ORIGIN}/legal?tab=privacy`,
  },
};

/** Single-path public pages, keyed by pathname. */
export const PUBLIC_PAGE_META = {
  "/browse": {
    title: "Browse Local Jobs — Helpr",
    description:
      "See what your Louisiana neighbors need help with right now. No account needed to look.",
    canonical: `${SITE_ORIGIN}/browse`,
    ogTitle: "Browse Local Jobs — Helpr",
    ogDescription:
      "Browse open jobs across Louisiana — cleaning, yard work, moving, errands, and more. No signup required to look.",
  },
  "/help": {
    title: "Help Center — Helpr",
    description:
      "Answers, guides, and support for everyone here — posting jobs, doing jobs, payments, safety, and account settings.",
    canonical: `${SITE_ORIGIN}/help`,
    ogTitle: "Louisiana Helpr Help Center",
    ogDescription: "Answers, guides, and support — for posting jobs and doing them alike.",
  },
  "/support": {
    // "X — Helpr", like every sibling page — the "| Louisiana's Local Job
    // Partner" long suffix belongs to the landing page's title alone.
    title: "Contact Support — Helpr",
    description:
      "Message the Helpr team about your account, a job, a payment, or a bug. No account needed — we reply by email.",
    canonical: `${SITE_ORIGIN}/support`,
    ogTitle: "Contact Support — Helpr",
    ogDescription:
      "Message the Helpr team about your account, a job, a payment, or a bug. No account needed — we reply by email.",
  },
};

/** Legal tab meta in the same full shape as PUBLIC_PAGE_META's entries. */
export function legalPageMeta(tab) {
  const m = LEGAL_PAGE_META[tab];
  return {
    title: m.title,
    description: m.description,
    canonical: m.canonical,
    ogTitle: m.title,
    ogDescription: m.description,
  };
}

/**
 * The head values for a public URL, or null when the path is not one of the
 * pages this table owns (the caller then serves the shell untouched).
 */
export function publicPageMetaFor(pathname, tabParam) {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/legal" || Object.prototype.hasOwnProperty.call(LEGAL_PATH_TAB, path)) {
    return legalPageMeta(resolveLegalTab(path, tabParam));
  }
  return Object.prototype.hasOwnProperty.call(PUBLIC_PAGE_META, path) ? PUBLIC_PAGE_META[path] : null;
}
