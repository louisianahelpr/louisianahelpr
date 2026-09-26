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

/**
 * Public pages that are deliberately NOT indexed (Q401a): auth entry points and
 * account-state screens that are public only because they render before a
 * session exists. They are out of the sitemap by choice (NOINDEX in
 * scripts/generate-sitemap.mjs), and until 2026-09-25 they served the
 * homepage's title and canonical before JS with the shell's "index, follow" —
 * telling a non-JS crawler each was a duplicate of `/`. vercel.json routes
 * them through api/share.ts (`_og=noindex`), which writes these values into
 * the pre-JS head; each page passes the same entry to usePageMeta, so the
 * values agree before and after JavaScript.
 */
export const NOINDEX_ROBOTS = "noindex, follow";

export const NOINDEX_PAGE_META = {
  "/login": {
    title: "Log In — Helpr",
    description: "Log in to your Helpr account.",
    canonical: `${SITE_ORIGIN}/login`,
    ogTitle: "Log In — Helpr",
    ogDescription: "Log in to your Helpr account to post jobs or pick up local work across Louisiana.",
    robots: NOINDEX_ROBOTS,
  },
  "/signup": {
    title: "Sign Up — Helpr",
    description: "Create your free Helpr account in under a minute.",
    canonical: `${SITE_ORIGIN}/signup`,
    ogTitle: "Sign Up — Helpr",
    ogDescription: "Join Helpr in under a minute and start posting jobs or earning as a verified Helpr across Louisiana.",
    robots: NOINDEX_ROBOTS,
  },
  "/forgot-password": {
    title: "Reset Password — Helpr",
    description: "Forgot your Helpr password? Enter your email and we'll send you a reset link.",
    canonical: `${SITE_ORIGIN}/forgot-password`,
    ogTitle: "Reset Password — Helpr",
    ogDescription: "Recover access to your Helpr account with a one-time password reset email.",
    robots: NOINDEX_ROBOTS,
  },
  "/reset-password": {
    title: "Set New Password — Helpr",
    description: "Choose a new password for your Helpr account.",
    canonical: `${SITE_ORIGIN}/reset-password`,
    ogTitle: "Set New Password — Helpr",
    ogDescription: "Finish resetting your Helpr password.",
    robots: NOINDEX_ROBOTS,
  },
  "/signup-pending": {
    title: "Check Your Email — Helpr",
    description: "Confirm your email address to finish creating your Helpr account.",
    canonical: `${SITE_ORIGIN}/signup-pending`,
    ogTitle: "Check Your Email — Helpr",
    ogDescription: "Confirm your email address to finish creating your Helpr account.",
    robots: NOINDEX_ROBOTS,
  },
  "/account-banned": {
    title: "Account Banned — Helpr",
    description: "This Helpr account has been banned. Contact support if you think this is a mistake.",
    canonical: `${SITE_ORIGIN}/account-banned`,
    ogTitle: "Account Banned — Helpr",
    ogDescription: "This Helpr account has been banned. Contact support if you think this is a mistake.",
    robots: NOINDEX_ROBOTS,
  },
};

/** The noindex head values for a path, or null when it is not one of those pages. */
export function noindexPageMetaFor(pathname) {
  const path = pathname.replace(/\/+$/, "") || "/";
  return Object.prototype.hasOwnProperty.call(NOINDEX_PAGE_META, path) ? NOINDEX_PAGE_META[path] : null;
}

/**
 * The landing page (`/`). Unlike every other page here it is NOT rewritten by
 * api/share.ts: it is served as the static index.html, so these values must
 * also be written verbatim in index.html's <title>, description, og:* and
 * twitter:* tags (HTML-escaped). Index.tsx's usePageMeta reads this entry.
 * Q401(b), owner 2026-09-26: the "Hire a Helpr…" copy wins, matching the
 * hero subhead and footer; index.html used to say "Helpr connects you with
 * trusted neighbors…" until JavaScript replaced it.
 * Pinned by src/test/publicRoutesServeOwnHead.test.ts.
 */
export const LANDING_PAGE_META = {
  title: "Helpr — Louisiana's Local Job Partner | Hire or Find Work",
  description:
    "Hire a Helpr or find local work in Louisiana. For everyday jobs, big and small — post or apply in minutes across New Orleans, Baton Rouge & beyond.",
  canonical: SITE_ORIGIN,
  ogTitle: "Helpr — Louisiana's Local Job Partner",
  ogDescription:
    "Hire a Helpr or find local work. For everyday jobs, big and small — Louisiana's trusted marketplace.",
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
