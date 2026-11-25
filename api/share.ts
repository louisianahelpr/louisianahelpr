/**
 * Per-route Open Graph tags for Helpr's shared links.
 *
 * THE PROBLEM
 * -----------
 * Helpr is a Vite SPA. Every route is served the same `dist/index.html`, whose
 * `og:*` tags are hard-coded to the marketing homepage. The app does set
 * per-route tags at runtime (`usePageMeta`), but link-preview crawlers do not
 * execute JavaScript — so a shared job, profile or invite has always previewed
 * in iMessage / WhatsApp / Facebook / Slack as:
 *
 *     Helpr — Louisiana's Local Job Partner
 *     https://www.louisianahelpr.com
 *
 * regardless of which URL was actually sent. Measured before this landed: all
 * seven probed routes returned the identical 28,728-byte document, sha256
 * dd0755819d6f941f, to all seven crawler and browser User-Agents.
 *
 * THE APPROACH — AND THE ONE RULE
 * -------------------------------
 * Since 2026-09-25 it also serves the public, indexable pages (/browse, /help,
 * /support, /legal and its /terms, /privacy, /rules aliases) so each carries
 * its own title, description, og:* and self-referencing canonical before JS
 * runs — see metaForPublicPage. The landing page `/` stays the static shell.
 *
 * This function is reached by path-scoped rewrites (see vercel.json), NOT by
 * sniffing the User-Agent. Humans and crawlers get byte-identical responses.
 * Serving crawlers a different page is cloaking and gets domains penalised;
 * injecting accurate tags into the same page is standard practice.
 *
 * It starts from the real built shell (`SHELL_HTML`, snapshotted from
 * dist/index.html at build time) and rewrites the VALUES of nine tags in
 * place. It never inserts, removes or reorders a tag. In particular it never
 * touches the og:image block — index.html's comments record that its ordering
 * is load-bearing (every major consumer takes the FIRST og:image, and
 * og:image:width/height/alt bind to the preceding parent by position, not by
 * name), and the safest way to honour that is to leave it completely alone.
 * One exception (SH2b, 2026-10-19): a shop card rewrites the VALUES of the
 * FIRST og:image block and twitter:image to the shop's own photo (Meta.image),
 * with width/height that match the rendered size; still no tag is added,
 * removed or reordered.
 *
 * PRIVACY
 * -------
 * A link preview is public to anyone the link is forwarded to and is cached by
 * Facebook, Slack, LinkedIn and Apple indefinitely. It is a strictly wider
 * audience than the page itself. So every value here comes from the same
 * anon-key read path the logged-out guest view already uses, and the column
 * list below is deliberately narrow — `description`, `photos` and
 * `customer_id` are NOT selected, so no future edit here can leak them.
 *
 * Verified against the anon key on 2026-08-31:
 *   • `open_jobs_browse.location` is `mask_job_location(location)` for anyone
 *     unassigned — city only ("Lafayette"). The view exposes no street
 *     address and no latitude/longitude column at all.
 *   • `jobs` itself is not readable by anon (42501 permission denied), so the
 *     masked view is the only path.
 *   • `budget` is returned to anon by BOTH `open_jobs_browse` and
 *     `get_public_open_jobs`, and is shown on the public browse grid.
 *   • The free-text `description` IS anon-readable, but is user-written and
 *     could contain a street address or gate code the poster typed. It is
 *     therefore excluded here on purpose — see the note on jobShareDescription.
 */

import { SHELL_HTML } from "../scripts/generated/og-shell.js";
import * as ogShellModule from "../scripts/generated/og-shell.js";
import { STATIC_PAGE_BODIES } from "../scripts/generated/static-pages.js";
import { noindexPageMetaFor } from "../src/lib/publicPageMeta.mjs";
import { publicOrGiftGuidePageMetaFor as publicPageMetaFor } from "../src/lib/giftGuidePageMeta.mjs";
import { giftGuidePageMeta } from "../src/lib/giftGuidePageMeta.mjs";
import { SEO_DATA } from "../scripts/generated/seo-data.js";
import { findTownPage } from "../src/lib/townPages.mjs";
import {
  breadcrumbLd,
  dealsDayOn,
  dealsGuideBody,
  giftGuideBody,
  giftGuideItemListLd,
  dealsItemListLd,
  giftGuidesLandingBody,
  giftGuidesLandingLd,
  hireBody,
  hireBreadcrumbLd,
  infoPageBody,
  infoPageBreadcrumbLd,
  jsonLdScript,
  notFoundBody,
  searchPageBody,
  twentyFiveDaysEventLd,
  type SeoData,
} from "../src/lib/seoBodies.mjs";
import { SEARCH_GUIDE_NAMES, searchPageBySlug, searchPageMeta, searchPageParent } from "../src/content/guideSearchPages.mjs";
import { holidayHubBody, holidayHubLd } from "../src/lib/holidayHubSeo.mjs";
import { QA_BYLINE, catalogGuideQa, dealPartsOn, dealsDayQa, faqPageLd, holidayHubQa, qaSectionHtml, smallBizQa, withQaSection, type QaItem } from "../src/lib/guideQa.mjs";
import { GUIDE_UPDATED } from "../src/content/guideUpdated.mjs";
import { SMALL_BIZ_CATEGORIES } from "../src/content/giftGuideSmallBiz.mjs";
import { HOLIDAY_LIGHTS } from "../src/content/holidayHub/lights.mjs";
import { HOLIDAY_EVENTS } from "../src/content/holidayHub/events.mjs";
import { louisianaToday } from "../src/content/holidayHub/holidayHub.mjs";
import { OG_PROFILE_HEIGHT, OG_PROFILE_WIDTH, ogProfileImageUrl } from "../src/lib/ogProfileCard.mjs";
import { browseShellRowsUrl, browseShellSeedsHiddenUrl, shellRowsWhenSeedsHidden, withBrowseShell } from "../src/lib/browseShellCards.mjs";
import { declutterGuestPreviewUrl, declutterPhotoPreloadHeader, firstPhotoPaths } from "../src/lib/declutterFirstPhotos.mjs";
import { shareCardPriceAmount, shareCardPriceLabel } from "../src/lib/declutter/shareCardPrice.mjs";
import { titleCase } from "../src/lib/declutter/titleCase.mjs";
import { OG_ITEM_HEIGHT, OG_ITEM_WIDTH, ogItemImageUrl } from "../src/lib/ogItemCard.mjs";
import { jobShareDescription } from "../src/lib/jobShareLine.mjs";
import { COVER_WEBP_SLUGS, OG_JPG_SLUGS } from "../src/lib/giftGuideShareImages.mjs";
import { COVER_VERSIONS, OG_VERSIONS } from "../src/lib/giftGuideCoverVersions.mjs";
import { WIDE_OG_VERSIONS } from "../src/lib/giftGuideWideOg.mjs";
import { DEALS_SLUG, DEALS_WORDS, dealDay, eventPhase, louisianaDay, oldDealsTarget } from "../src/content/giftGuideDeals.mjs";
import { isLiveGuide } from "../src/content/giftGuideLive.mjs";

/**
 * og:url and the canonical link are built from this constant, never from the
 * request's Host header — a forged Host would otherwise poison the canonical
 * URL of every preview. Overridable only by server-side env (used when
 * verifying on a throwaway preview deployment).
 */
const SITE_ORIGIN = (process.env.OG_SITE_ORIGIN || "https://www.louisianahelpr.com").replace(/\/$/, "");

const SUPABASE_URL = (
  process.env.VITE_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SUPABASE_ANON_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";

/** Budget upstream of the response. A slow database must never stall a share. */
const DB_TIMEOUT_MS = 1500;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
/** Referral codes are alphanumeric; anything else is not a code we will echo. */
const REF_CODE_RE = /^[A-Za-z0-9_-]{3,32}$/;

interface Meta {
  /** Document <title>. */
  title: string;
  /** name="description" — also reused for og/twitter description unless ogDescription is set. */
  description: string;
  /** og/twitter description when the card copy differs from name="description". */
  ogDescription?: string;
  /** Card headline. */
  ogTitle: string;
  /** Absolute canonical URL for this route. */
  url: string;
  /**
   * `<meta name="robots">` content. Omitted means "leave the shell's default
   * (index, follow) alone" — only sign-in-gated preview routes override it to
   * "noindex, follow", since those routes bounce an anonymous crawler through
   * `<ProtectedRoute>` and must never be indexed. See the comment beside the
   * tag in index.html for why this exists instead of a robots.txt path
   * Disallow: a Disallow blocks the FETCH (which is exactly what a link
   * preview needs to succeed), while noindex only blocks indexing after a
   * successful fetch.
   */
  robots?: string;
  /**
   * L7 (owner 11-05): also answer `X-Robots-Tag: noindex`. Set on every /u/<handle> response unless its member
   * turned "Show my profile in search engines" on; vercel.json no longer sends that header for /u/ because it
   * would win over the member's choice.
   */
  noindexHeader?: boolean;
  /**
   * SH2b shop cards only: the shop's own photo. Applied as VALUES on the FIRST
   * og:image block (url, type, width, height, alt) and twitter:image; no tag
   * is added, removed or reordered, so the positional binding index.html
   * relies on holds. Omitted everywhere else: those cards keep the H mark.
   */
  image?: { url: string; type: string; width: number; height: number; alt: string };
  /** CDN cache override (shop cards: minutes, so a hidden or paused shop stops previewing). */
  cdnCache?: string;
  /**
   * LEAD-PROFILE-LINK: keep exactly ONE og:image (the shell carries a second, square brand fallback). A profile
   * card is the member's photo; a fallback logo beside it is what some scrapers pick instead.
   */
  singleImage?: boolean;
  /**
   * Owner 11-20 (site polish E): a Declutter item's price as Open Graph product tags (product:price:amount "85.00",
   * product:price:currency "USD"), the seller's price. Added right before </head> (the shell has no such anchors).
   */
  productPrice?: { amount: string; currency: "USD" };
}

/* ------------------------------------------------------------------ *
 * Escaping
 * ------------------------------------------------------------------ */

/**
 * Every value written here originates from user-entered content (a job title
 * a customer typed). It lands inside a double-quoted HTML attribute, so an
 * unescaped `"` would break out of the attribute and an unescaped `<` could
 * open a tag. Escape the full set, not just quotes.
 */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Text node escaping for <title>. */
function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Normalise anything user-supplied before it becomes a tag value: strip
 * control characters (a newline inside an attribute is legal but mangles the
 * card), collapse runs of whitespace, and cap the length so a pathological
 * title cannot bloat the document.
 */
function clean(value: string | null | undefined, max: number): string {
  if (!value) return "";
  // Stripping control characters IS this function's job (see the block comment
  // above); the rule fires on the very range we intend to match.
  // eslint-disable-next-line no-control-regex
  const stripped = String(value).replace(/[\u0000-\u001F\u007F]+/g, " ");
  const collapsed = stripped.replace(/\s+/g, " ").trim();
  if (collapsed.length <= max) return collapsed;
  return collapsed.slice(0, max - 1).trimEnd() + "…";
}

/* ------------------------------------------------------------------ *
 * Tag rewriting
 * ------------------------------------------------------------------ */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace the `content` of the FIRST matching meta tag. Deliberately not
 * global: the shell carries exactly one og:image (owner 10-31: a second, square
 * one let iMessage show the H mark doubled and cut off), and a global replace is
 * the kind of thing that quietly becomes wrong later.
 *
 * If the tag is not found the document is returned unchanged rather than
 * throwing — a preview that falls back to today's card is a far better
 * failure than a 500 on a route real users open. `scripts/build-og-shell.mjs`
 * asserts every anchor exists at build time, so a miss here fails the build,
 * not the request.
 */
function setMetaContent(
  html: string,
  kind: "property" | "name",
  key: string,
  value: string,
): string {
  const re = new RegExp(`(<meta ${kind}="${escapeRegExp(key)}" content=")[^"]*(")`);
  return html.replace(re, (_match, head: string, tail: string) => head + escapeAttr(value) + tail);
}

function applyMeta(html: string, meta: Meta): string {
  let out = html;
  out = out.replace(
    /<title>[\s\S]*?<\/title>/,
    () => `<title>${escapeText(meta.title)}</title>`,
  );
  out = out.replace(
    /(<link rel="canonical" href=")[^"]*(">)/,
    (_m, head: string, tail: string) => head + escapeAttr(meta.url) + tail,
  );
  out = setMetaContent(out, "name", "description", meta.description);
  out = setMetaContent(out, "property", "og:url", meta.url);
  out = setMetaContent(out, "property", "og:title", meta.ogTitle);
  out = setMetaContent(out, "property", "og:description", meta.ogDescription ?? meta.description);
  out = setMetaContent(out, "name", "twitter:url", meta.url);
  out = setMetaContent(out, "name", "twitter:title", meta.ogTitle);
  out = setMetaContent(out, "name", "twitter:description", meta.ogDescription ?? meta.description);
  if (meta.robots) out = setMetaContent(out, "name", "robots", meta.robots);
  if (meta.image) {
    out = setMetaContent(out, "property", "og:image", meta.image.url);
    out = setMetaContent(out, "property", "og:image:type", meta.image.type);
    out = setMetaContent(out, "property", "og:image:width", String(meta.image.width));
    out = setMetaContent(out, "property", "og:image:height", String(meta.image.height));
    out = setMetaContent(out, "property", "og:image:alt", meta.image.alt);
    out = setMetaContent(out, "name", "twitter:image", meta.image.url);
    out = setMetaContent(out, "name", "twitter:image:alt", meta.image.alt);
  }
  if (meta.singleImage) {
    let seen = 0;
    out = out.replace(/[ \t]*<meta property="og:image" content="[^"]*"\s*\/?>\n?/g, (tag) => (seen++ === 0 ? tag : ""));
  }
  if (meta.productPrice) {
    const tags = `<meta property="product:price:amount" content="${escapeAttr(meta.productPrice.amount)}" />\n<meta property="product:price:currency" content="${meta.productPrice.currency}" />`;
    out = out.replace("</head>", () => `${tags}\n</head>`);
  }
  return out;
}

/**
 * ICON LINKS, ABSOLUTE (owner, 2026-09-14, VN-4: the share sheet showed "the
 * compass" instead of the H logo for a shared /jobs/:id link).
 *
 * The shell ships its favicon / apple-touch-icon links root-relative
 * (`href="/apple-touch-icon.png"`), which is right for the SPA — the native
 * bundle serves them from its own origin. A link-preview fetcher, though, reads
 * this document detached from any page, and the OS share sheet's placeholder
 * glyph is what it draws when it cannot turn a link into an icon. og:image in
 * the same head was already absolute; the icons were the one set of image
 * references a fetcher had to resolve for itself.
 *
 * Same rule as applyMeta: VALUES only. The tags, their order and their other
 * attributes are untouched, and every visitor — human or crawler — still gets
 * the same bytes. Only a root-relative path (`/x`, never `//host`) is
 * rewritten, and it is resolved against SITE_ORIGIN, never the request Host.
 * `scripts/build-og-shell.mjs` asserts at build time that these links exist.
 */
const ICON_RELS = ["icon", "shortcut icon", "apple-touch-icon", "apple-touch-icon-precomposed"];
const ICON_LINK_RE = new RegExp(
  `(<link rel="(?:${ICON_RELS.map(escapeRegExp).join("|")})"[^>]*?\\shref=")(\\/(?!\\/)[^"]*)(")`,
  "g",
);

function absolutiseIconLinks(html: string, origin: string = SITE_ORIGIN): string {
  return html.replace(
    ICON_LINK_RE,
    (_m, head: string, path: string, tail: string) => head + escapeAttr(origin + path) + tail,
  );
}

/* ------------------------------------------------------------------ *
 * Data — anon key only, same read path as the logged-out guest view
 * ------------------------------------------------------------------ */

interface PublicJob {
  id: string;
  title: string | null;
  category: string | null;
  budget: number | null;
  location: string | null;
  date_needed: string | null;
  pricing_mode: string | null;
  expires_at: string | null;
  /** The share line's parish, window and take-home inputs (F269a): all public columns of open_jobs_browse. */
  parish: string | null;
  date_window_end: string | null;
  urgent_fee: number | null;
  is_group_job: boolean | null;
  helpers_needed: number | null;
  helper_fee_flat_cents: number | null;
  helper_fee_percent: number | null;
  /** Public job-photos URLs (the guest page already shows them). Only whether one exists is used here. */
  photos: string[] | null;
}

/**
 * `open_jobs_browse` is the RLS-public masked view `src/pages/jobs/JobDetail.tsx`
 * already reads for guests. The column list is intentionally the minimum this
 * card needs — see the privacy note at the top of the file.
 */
/**
 * Three outcomes, and the difference between the last two matters:
 *   found   — the job is public and open
 *   absent  — the database answered, and there is no such public job
 *   unknown — we could not ask (no env, timeout, 5xx, network error)
 *
 * Only `absent` justifies telling the world "this job is no longer available".
 * Claiming that because the lookup failed would be a confident statement about
 * something we never checked — so `unknown` falls back to the generic shell,
 * which is exactly the behaviour of the site today.
 */
type JobLookup =
  | { state: "found"; job: PublicJob }
  | { state: "absent" }
  | { state: "unknown" };

async function fetchPublicJob(id: string): Promise<JobLookup> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { state: "unknown" };
  const columns =
    "id,title,category,budget,location,date_needed,pricing_mode,expires_at,photos,parish,date_window_end,urgent_fee,is_group_job,helpers_needed,helper_fee_flat_cents,helper_fee_percent";
  const endpoint =
    `${SUPABASE_URL}/rest/v1/open_jobs_browse` +
    `?select=${encodeURIComponent(columns)}&id=eq.${encodeURIComponent(id)}&limit=1`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!res.ok) return { state: "unknown" };
    const rows = (await res.json()) as PublicJob[];
    if (!Array.isArray(rows)) return { state: "unknown" };
    return rows.length ? { state: "found", job: rows[0] } : { state: "absent" };
  } catch {
    // Timeout, DNS, connection refused — we did not learn anything.
    return { state: "unknown" };
  }
}

/* ------------------------------------------------------------------ *
 * Card copy
 * ------------------------------------------------------------------ */

/** "yard_work" -> "Yard work". Derived, so a new enum value can never go stale. */
function humaniseCategory(category: string | null): string {
  const raw = clean(category, 40).replace(/_/g, " ").toLowerCase();
  if (!raw) return "Job";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * The card body for a job: the ONE share line (owner 11-11, F269a), "Cleaning · Iberia Parish · Sun, Nov 29 · $116",
 * from src/lib/jobShareLine.mjs, the same function the page's usePageMeta calls, so og:description,
 * twitter:description and name=description agree before and after JS runs. Structured, already-public fields only,
 * never the job's free-text `description`: it is the one field a customer can type a street address or a gate code
 * into, and this string is cached by third parties indefinitely and shown to people who never open the link.
 */
/**
 * A job id that resolves to nothing — deleted, filled, expired, or simply
 * never existed. It must NOT produce a confident card for a job that isn't
 * there. The honest card says so; the page underneath renders its real
 * "job not found" empty state with a route back to Browse.
 */
function unavailableJobMeta(url: string): Meta {
  return {
    // F110 (owner audit 11-09): the TAB title stays neutral. `open_jobs_browse` lists only OPEN jobs, so a hired, done or
    // cancelled job reads as absent here even for its own poster and Helpr, whose tab then said "This job is no longer
    // available" until the app drew the job's title. The share card (ogTitle, description) still says so honestly.
    // Guard: src/test/jobTabTitleNeutral.test.ts.
    title: "Job — Helpr",
    ogTitle: "This job is no longer available",
    description:
      "This job has been filled, expired, or removed. Browse open jobs near you on Helpr — Louisiana's local job marketplace.",
    url,
    // A job page is short-lived and a guest only gets a preview of it, so this
    // URL stays out of search results. See index.html's comment.
    robots: "noindex, follow",
  };
}

/* ------------------------------------------------------------------ *
 * Shops (SH2b, owner 2026-10-19): a shop page anyone with the link can see
 * ------------------------------------------------------------------ */

/**
 * The card reads shops_public_shop, the same anon RPC the signed-out page
 * reads (migration 20261019042744): only what the public page shows, never
 * the owner id, the pin, the SoS number or the pickup address. NULL (hidden,
 * paused, owner switched off, no such shop) is `absent`.
 */
interface PublicShopCard {
  name: string;
  about: string | null;
  category_label: string | null;
  area_label: string | null;
  photos: { id: string; kind: string }[] | null;
}

type ShopLookup = { state: "found"; shop: PublicShopCard } | { state: "absent" } | { state: "unknown" };

async function fetchPublicShopCard(id: string): Promise<ShopLookup> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { state: "unknown" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/shops_public_shop`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_shop_id: id }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!res.ok) return { state: "unknown" };
    const body = (await res.json()) as PublicShopCard | null;
    if (body === null) return { state: "absent" };
    if (typeof body !== "object" || typeof body.name !== "string") return { state: "unknown" };
    return { state: "found", shop: body };
  } catch {
    // Timeout, DNS, connection refused: we learned nothing, so the generic shell.
    return { state: "unknown" };
  }
}

/** Shop pages stay out of search until the Shops switch opens to everyone. */
export const SHOP_ROBOTS = "noindex, follow";
const SHOP_CDN_CACHE = "public, s-maxage=60, stale-while-revalidate=60";

/**
 * The shop's cover (else its logo) at 1200x630 (630x630 for a logo), so the
 * declared og:image width/height are true. Served by photo ID through the
 * shop-photo edge function, never by storage path: the path starts with the
 * owner's user id, and this URL sits in third-party preview caches for good
 * (lh-authz-rls review, must-fix 1). The function re-checks the shop is
 * link-visible on every fetch.
 */
function shopImage(shop: PublicShopCard): Meta["image"] | undefined {
  const photos = Array.isArray(shop.photos) ? shop.photos : [];
  const pick = photos.find((p) => p.kind === "cover") ?? photos.find((p) => p.kind === "logo");
  if (!pick || typeof pick.id !== "string" || !UUID_RE.test(pick.id) || !SUPABASE_URL) return undefined;
  const square = pick.kind === "logo";
  const w = square ? 630 : 1200;
  return {
    url: `${SUPABASE_URL}/functions/v1/shop-photo?id=${pick.id}&kind=shop&w=${w}&og=1`,
    type: "image/jpeg",
    width: w,
    height: 630,
    alt: clean(`${shop.name} on Louisiana Helpr`, 120),
  };
}

function unavailableShopMeta(url: string): Meta {
  return {
    title: "This shop isn't available — Helpr",
    ogTitle: "This shop isn't available",
    description: "This shop may be paused or closed. Find local shops and Helprs on Louisiana Helpr.",
    url,
    robots: SHOP_ROBOTS,
    cdnCache: SHOP_CDN_CACHE,
  };
}

async function metaForShop(id: string, url: string): Promise<Meta | null> {
  if (!UUID_RE.test(id)) return unavailableShopMeta(url);
  const lookup = await fetchPublicShopCard(id);
  if (lookup.state === "unknown") return null;
  if (lookup.state === "absent") return unavailableShopMeta(url);
  const shop = lookup.shop;
  const name = clean(shop.name, 60);
  if (!name) return unavailableShopMeta(url);
  const what = [clean(shop.category_label, 60), clean(shop.area_label, 80)].filter(Boolean).join(" in ");
  const about = clean(shop.about, 140);
  return {
    title: `${name} — Helpr`,
    ogTitle: name,
    description: clean([what ? `${what}.` : "A local shop on Louisiana Helpr.", about].filter(Boolean).join(" "), 200),
    url,
    robots: SHOP_ROBOTS,
    image: shopImage(shop),
    cdnCache: SHOP_CDN_CACHE,
  };
}

/* ------------------------------------------------------------------ *
 * Declutter items (Q2426, owner 2026-10-27): share an item to Facebook
 * ------------------------------------------------------------------ */

/**
 * The card reads declutter_public_item_card (migration 20261027194426), an
 * anon RPC returning only what the card shows: title, price now (0 is Free),
 * the town buyers already see, and the cover photo's ID. Never the seller id,
 * the description (free text), the floor, the pickup address or a storage
 * path. NULL (sold, withdrawn, hidden, Declutter off, no such item) is `absent`.
 */
interface PublicItemCard {
  title: string;
  price_cents: number;
  area_label: string | null;
  photo_id: string | null;
}

type ItemLookup = { state: "found"; item: PublicItemCard } | { state: "absent" } | { state: "unknown" };

async function fetchPublicItemCard(id: string): Promise<ItemLookup> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { state: "unknown" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/declutter_public_item_card`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_item_id: id }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!res.ok) return { state: "unknown" };
    const body = (await res.json()) as PublicItemCard | null;
    if (body === null) return { state: "absent" };
    if (typeof body !== "object" || typeof body.title !== "string" || typeof body.price_cents !== "number") {
      return { state: "unknown" };
    }
    return { state: "found", item: body };
  } catch {
    // Timeout, DNS, connection refused: we learned nothing, so the generic shell.
    return { state: "unknown" };
  }
}

/** The item page is sign-in only: the card is public, the page is not, so it is never indexed. */
const DECLUTTER_ITEM_ROBOTS = "noindex, follow";
/** Minutes, not a day: a sold or withdrawn item stops previewing as for sale. */
const DECLUTTER_ITEM_CDN_CACHE = "public, s-maxage=60, stale-while-revalidate=60";

/**
 * Owner 11-20 (site polish E): the cover drawn by api/og-item.ts, 1200x630, with the WHOLE photo inside the centre
 * square, so it is safe at both 1:1 and 1.91:1 (shop-photo's cover crop cut a portrait photo to a thin band). By item
 * and photo ID, never by storage path (the path starts with the seller's user id, and this URL sits in third-party
 * preview caches for good); og-item re-reads the card and fetches the photo through shop-photo kind=declutter.
 */
function itemImage(itemId: string, item: PublicItemCard, title: string): Meta["image"] | undefined {
  const id = item.photo_id;
  if (typeof id !== "string" || !UUID_RE.test(id)) return undefined;
  const url = ogItemImageUrl(SITE_ORIGIN, itemId, id);
  if (!url) return undefined;
  return {
    url,
    type: "image/png",
    width: OG_ITEM_WIDTH,
    height: OG_ITEM_HEIGHT,
    alt: clean(`${title} on Louisiana Helpr`, 120),
  };
}

function unavailableItemMeta(url: string): Meta {
  return {
    title: "This item isn't available — Helpr",
    ogTitle: "This item isn't available",
    description: "It may have sold or been taken down. Find more secondhand finds from neighbors on Louisiana Helpr.",
    url,
    robots: DECLUTTER_ITEM_ROBOTS,
    cdnCache: DECLUTTER_ITEM_CDN_CACHE,
  };
}

async function metaForDeclutterItem(id: string, url: string): Promise<Meta | null> {
  if (!UUID_RE.test(id)) return unavailableItemMeta(url);
  const lookup = await fetchPublicItemCard(id);
  if (lookup.state === "unknown") return null;
  if (lookup.state === "absent") return unavailableItemMeta(url);
  const item = lookup.item;
  // Owner 11-20 (site polish E): the title in the item page's smart title case ("Vintage Duck Touch Lamp").
  const title = clean(titleCase(item.title), 80);
  if (!title) return unavailableItemMeta(url);
  // Owner 11-20 (site polish E, reverses 11-09 F076): the SELLER's price ("$85"), not the fee-inclusive total. "Free"
  // for $0.
  const price = shareCardPriceLabel(item.price_cents);
  const amount = shareCardPriceAmount(item.price_cents);
  const town = clean(item.area_label, 80);
  return {
    productPrice: amount ? { amount, currency: "USD" } : undefined,
    title: `${title} — Helpr`,
    // Facebook shows og:title in bold on the card: the price rides on it so it is seen at a glance.
    ogTitle: clean(`${title} · ${price}`, 100),
    // No "pay in the app" (F076): on the website a visitor can buy too.
    description: clean(`From a neighbor${town ? ` in ${town}` : ""} on Louisiana Helpr. Pick it up nearby.`, 200),
    url,
    robots: DECLUTTER_ITEM_ROBOTS,
    image: itemImage(id, item, title),
    cdnCache: DECLUTTER_ITEM_CDN_CACHE,
  };
}

/* ------------------------------------------------------------------ *
 * Routing
 * ------------------------------------------------------------------ */

/** `null` means "say nothing new" — the caller serves the untouched shell. */
async function metaForJob(id: string, url: string): Promise<Meta | null> {
  // Not a job id at all. No lookup needed to know this link points at nothing.
  if (!UUID_RE.test(id)) return unavailableJobMeta(url);

  const lookup = await fetchPublicJob(id);
  if (lookup.state === "unknown") return null;
  if (lookup.state === "absent") return unavailableJobMeta(url);

  const job = lookup.job;
  if (job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) {
    return unavailableJobMeta(url);
  }
  const title = clean(job.title, 90);
  if (!title) return unavailableJobMeta(url);
  return {
    // Matches what usePageMeta sets client-side, so a JS-executing crawler and
    // a non-executing one agree on the card.
    title: `${title} — Helpr`,
    ogTitle: title,
    description: clean(jobShareDescription(job), 200),
    url,
    // Same rationale as unavailableJobMeta above.
    robots: "noindex, follow",
    image: jobImage(job, title),
  };
}

/**
 * GROW-6 (10-31): a job with a photo previews with ITS first photo, at exactly 1200x630, through shop-photo
 * kind=job keyed by the JOB id (already in the shared URL). Never the photo's own URL: its storage path starts
 * with the poster's user id, and this URL sits in third-party preview caches for good (the shop card's
 * lh-authz-rls must-fix 1). shop-photo re-reads open_jobs_browse on every fetch, so a filled, expired or
 * removed job stops serving its photo. No photo: no image block, so the shell's own card image, the Helpr mark
 * (index.html og-image.png), stays: the logo fallback the owner asked for (owner 11-11, F269a).
 */
function jobImage(job: PublicJob, title: string): Meta["image"] | undefined {
  const first = Array.isArray(job.photos) ? job.photos.find((p) => typeof p === "string" && p.length > 0) : undefined;
  if (!first || !UUID_RE.test(job.id) || !SUPABASE_URL) return undefined;
  return {
    url: `${SUPABASE_URL}/functions/v1/shop-photo?id=${job.id}&kind=job&w=1200&og=1`,
    type: "image/jpeg",
    width: 1200,
    height: 630,
    alt: clean(`${title} on Louisiana Helpr`, 120),
  };
}

/**
 * A referral link. There is deliberately no name on this card.
 *
 * Verified with the anon key: `referral_codes` returns zero rows to anon (RLS),
 * so there is no public path from a code to its owner — and resolving one would
 * need the service-role key, which must never be used to build something this
 * widely cached. That constraint is also the better product answer: a code
 * pasted into a group chat should not broadcast who owns it.
 *
 * og:url drops the ?ref= on purpose. The card is identical for every code, so
 * one canonical URL means one preview-cache entry across all consumers instead
 * of one per referrer — and no referral code lands in Facebook's or Slack's
 * cache. Attribution is unaffected: it rides on the URL the recipient actually
 * clicks, not on this metadata.
 */
function metaForSignup(ref: string | null): Meta {
  const invited = !!ref && REF_CODE_RE.test(ref);
  // Q401a: /signup is noindex (an auth entry point, out of the sitemap by
  // choice). An invite link is the same page, so it says so too: the page's
  // own usePageMeta sets the same robots after JS.
  const signup = noindexPageMetaFor("/signup")!;
  if (!invited) return metaForNoindexPage("signup")!;
  return {
    title: "You've been invited to Helpr",
    ogTitle: "You've been invited to join Helpr",
    description:
      "A neighbor invited you to Helpr — Louisiana's local job marketplace for cleaning, yard work, moving and errands. Sign up free with their invite.",
    url: signup.canonical,
    robots: signup.robots,
  };
}

/**
 * A profile link.
 *
 * `/user/:userId` is wrapped in <ProtectedRoute> (src/App.tsx), so a
 * logged-out recipient is bounced to /login and never sees the profile. That
 * decides the card: `get_safe_profiles` would happily return this person's real
 * name, city, skills and rating to the anon key, but building a rich card out
 * of it would promise a page the recipient cannot open — and would park a real
 * person's full name in third-party preview caches forever in exchange for
 * nothing. So the card carries no name, no avatar and no rating, and is honest
 * about the login wall instead.
 *
 * The real fix is upstream: make /user/:userId publicly viewable the way
 * /jobs/:id already is. The data is ALREADY anon-public, so the moment that
 * route opens up, a proper named card becomes both useful and safe.
 */
/* ------------------------------------------------------------------ *
 * "Book me on Helpr" (B59, 2026-10-29): /book/<user id>
 * ------------------------------------------------------------------ */

/**
 * The same two anon reads the signed-out /book page makes, and nothing else:
 * get_safe_profiles (masked "First L." name for anon, town, photo) and
 * get_public_profile_stats (counts). Bio and skills are not put on the card;
 * the photo is (GROW-6: the /book page already shows it to signed-out visitors). No row = banned, deleted, unverified or a hidden test account:
 * `absent`.
 */
interface BookProfile { full_name: string | null; location: string | null; avatar_url?: string | null }
interface BookStats { review_count: number | null; avg_rating: number | null; completed_jobs_as_helper: number | null }
type BookLookup = { state: "found"; profile: BookProfile; stats: BookStats | null } | { state: "absent" } | { state: "unknown" };

async function anonRpc<T>(fn: string, body: unknown): Promise<T | undefined> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DB_TIMEOUT_MS),
  });
  if (!res.ok) return undefined;
  return (await res.json()) as T;
}

async function fetchBookCard(id: string): Promise<BookLookup> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { state: "unknown" };
  try {
    const [profiles, stats] = await Promise.all([
      anonRpc<BookProfile[]>("get_safe_profiles", { user_ids: [id] }),
      // Stats are a nicety: a failed stats read still gives a named card.
      anonRpc<BookStats[]>("get_public_profile_stats", { p_user_ids: [id] }).catch(() => undefined),
    ]);
    if (!Array.isArray(profiles)) return { state: "unknown" };
    if (!profiles.length) return { state: "absent" };
    return { state: "found", profile: profiles[0], stats: Array.isArray(stats) && stats.length ? stats[0] : null };
  } catch {
    // Timeout, DNS, connection refused: we did not learn anything.
    return { state: "unknown" };
  }
}

/**
 * H5 (share-profile audit 11-05, one public profile link): the member's current /u handle for an old /book/<id> or
 * /user/<id> link, through handle_for_user (20261105171316; NULL under exactly public_profile_by_handle's rules).
 * `unknown` (not deployed yet, timeout, any fault) keeps the old card.
 */
type HandleLookup = { state: "found"; handle: string } | { state: "absent" } | { state: "unknown" };
async function fetchHandleForUser(id: string): Promise<HandleLookup> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !UUID_RE.test(id)) return { state: "unknown" };
  try {
    const handle = await anonRpc<string | null>("handle_for_user", { p_user_id: id });
    if (handle === undefined) return { state: "unknown" };
    return typeof handle === "string" && HANDLE_RE.test(handle) ? { state: "found", handle } : { state: "absent" };
  } catch {
    // Timeout, DNS, connection refused: we did not learn anything.
    return { state: "unknown" };
  }
}

/** An old /book or /user link whose member has a public page gets that page's card, its og:url the /u link. */
async function profileCardForUserId(id: string): Promise<Meta | null | "absent" | "unknown"> {
  const h = await fetchHandleForUser(id);
  if (h.state !== "found") return h.state;
  return metaForProfile(h.handle, `${SITE_ORIGIN}/u/${h.handle}`);
}

const BOOK_ROBOTS = "noindex, follow";
const BOOK_CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=600";

function bookTrust(stats: BookStats | null): string {
  if (!stats) return "";
  const parts: string[] = [];
  const reviews = Number(stats.review_count ?? 0);
  const avg = stats.avg_rating == null ? NaN : Number(stats.avg_rating);
  if (reviews > 0 && Number.isFinite(avg)) parts.push(`${avg.toFixed(1)} stars (${reviews} review${reviews === 1 ? "" : "s"})`);
  const done = Number(stats.completed_jobs_as_helper ?? 0);
  if (done > 0) parts.push(`${done} job${done === 1 ? "" : "s"} done`);
  return parts.join(" · ");
}

function unavailableBookMeta(url: string): Meta {
  return {
    title: "This Helpr isn't available — Helpr",
    ogTitle: "This Helpr isn't available",
    description: "Post a job on Louisiana Helpr and local Helprs can say yes.",
    url,
    robots: BOOK_ROBOTS,
    cdnCache: BOOK_CDN_CACHE,
  };
}

async function metaForBook(id: string, url: string): Promise<Meta | null> {
  if (!UUID_RE.test(id)) return unavailableBookMeta(url);
  // H5: the /book page forwards to /u/<handle>, so its card is that page's; no public page = not available.
  const u = await profileCardForUserId(id);
  if (u === "absent") return unavailableBookMeta(url);
  if (u !== "unknown") return u;
  const lookup = await fetchBookCard(id);
  if (lookup.state === "unknown") return null;
  if (lookup.state === "absent") return unavailableBookMeta(url);
  const name = clean(lookup.profile.full_name, 40) || "a Helpr";
  const first = name.split(" ")[0] || name;
  const town = clean(lookup.profile.location, 60);
  const trust = bookTrust(lookup.stats);
  const lead = `${first} is a Helpr${town ? ` in ${town}` : ""} on Louisiana Helpr.`;
  return {
    title: `Book ${name} on Louisiana Helpr`,
    ogTitle: `Book ${name} on Louisiana Helpr`,
    description: clean(
      `${lead}${trust ? ` ${trust}.` : ""} Covered by the Helpr Guarantee. Payment is held safely until the work is done.`,
      200,
    ),
    url,
    robots: BOOK_ROBOTS,
    image: bookImage(lookup.profile.avatar_url, id, name),
    cdnCache: BOOK_CDN_CACHE,
  };
}

/** Types storage keeps under format=origin; webp and gif are left off (link-card support not measured). */
const AVATAR_TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png" };

/**
 * GROW-6 (10-31): a Helpr's Book me link previews with their own photo, 630x630, cut square by the storage
 * render endpoint (format=origin keeps the stored type, so og:image:type is true). Only an avatar this
 * project stores in that Helpr's own avatars/<user id>/ folder (the user id is already in the /book URL);
 * a social-login photo, another folder or an unknown type gives no image block.
 */
function bookImage(avatarUrl: string | null | undefined, userId: string, name: string): Meta["image"] | undefined {
  if (typeof avatarUrl !== "string" || !SUPABASE_URL || !UUID_RE.test(userId)) return undefined;
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/avatars/${userId}/`;
  if (!avatarUrl.startsWith(prefix)) return undefined;
  const file = avatarUrl.slice(prefix.length).split(/[?#]/)[0];
  const ext = /^avatar\.([a-z]+)$/.exec(file)?.[1];
  const type = ext ? AVATAR_TYPES[ext] : undefined;
  if (!type) return undefined;
  return {
    url: `${SUPABASE_URL}/storage/v1/render/image/public/avatars/${userId}/${file}?width=630&height=630&resize=cover&quality=80&format=origin`,
    type,
    width: 630,
    height: 630,
    alt: clean(`${name} on Louisiana Helpr`, 120),
  };
}

/* ------------------------------------------------------------------ *
 * Shareable profile link (LEAD-PROFILE-LINK, owner 2026-10-31): /u/<handle>
 * ------------------------------------------------------------------ */

/** The same handle rule the database checks (profiles_handle_format). */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,29}$/;
const PROFILE_ROBOTS = "noindex, follow";
/** L7 (owner 11-05: search engines opt-in per member, default off): only an exact `true` indexes the page. */
const PROFILE_ROBOTS_SHOWN = "index, follow";
const PROFILE_CDN_CACHE = "public, s-maxage=300, stale-while-revalidate=600";

/** The few public fields the card uses from public_profile_by_handle (the same anon read the page makes). */
interface ProfileCard {
  /** The member's CURRENT handle: an old (retired) one in the link answers with the new one (L2, audit 11-05). */
  handle?: string | null;
  name: string | null;
  photo_url: string | null;
  stats?: { review_count?: number | null; avg_rating?: number | null } | null;
  helpr?: { jobs_done?: number | null } | null;
  listings?: unknown[] | null;
  jobs?: unknown[] | null;
  show_in_search?: boolean | null;
  /** M1 (audit 11-05): the true counts (listings holds at most 500) and the header fields (20261105165059). */
  listing_count?: number | null;
  job_count?: number | null;
  town?: string | null;
  skills?: string | null;
}
type ProfileLookup = { state: "found"; card: ProfileCard } | { state: "absent" } | { state: "unknown" };

async function fetchProfileCard(handle: string): Promise<ProfileLookup> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return { state: "unknown" };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/public_profile_by_handle`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_handle: handle }),
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
    if (!res.ok) return { state: "unknown" };
    const card = (await res.json()) as ProfileCard | null;
    return card && typeof card === "object" ? { state: "found", card } : { state: "absent" };
  } catch {
    // Timeout, DNS, connection refused: we did not learn anything.
    return { state: "unknown" };
  }
}

/**
 * M1 slice 2 (share-profile audit 11-05, Q2759): the /u card's ONE og:image is the branded 1200x630 card drawn by
 * api/og-profile.ts (photo or initial, name, town, rating, counts, brand), not the bare avatar crop. Its ?v= tag
 * changes with everything the card draws, so a crawler that caches images by URL fetches the new card after an edit.
 * og-profile reads the same public_profile_by_handle answer and answers the brand image on any miss.
 */
function profileCardImage(handle: string, card: ProfileCard, name: string): Meta["image"] {
  return {
    url: ogProfileImageUrl(SITE_ORIGIN, handle, card),
    type: "image/png",
    width: OG_PROFILE_WIDTH,
    height: OG_PROFILE_HEIGHT,
    alt: clean(`${name} on Louisiana Helpr`, 120),
  };
}

/** "Yard work, Handyman": the first three comma-separated skills, as the page's chips read them. */
function profileSkillsLine(skills: string | null | undefined): string {
  const parts = [...new Set(clean(skills, 200).split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 3);
  return parts.join(", ");
}

/** A count the read states, else the length of the list it returned (an older read had no count). */
function profileCount(count: number | null | undefined, list: unknown[] | null | undefined): number {
  const n = Number(count);
  return Number.isFinite(n) && n >= 0 ? n : Array.isArray(list) ? list.length : 0;
}

function unavailableProfileMeta(url: string): Meta {
  return {
    title: "This profile isn't available — Helpr",
    ogTitle: "This profile isn't available",
    description: "Find local help and secondhand finds from neighbors on Louisiana Helpr.",
    url,
    robots: PROFILE_ROBOTS,
    noindexHeader: true,
    cdnCache: PROFILE_CDN_CACHE,
    singleImage: true,
  };
}

async function metaForProfile(rawHandle: string, url: string): Promise<Meta | null> {
  const handle = rawHandle.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) return unavailableProfileMeta(url);
  const lookup = await fetchProfileCard(handle);
  if (lookup.state === "unknown") return null;
  if (lookup.state === "absent") return unavailableProfileMeta(url);
  const card = lookup.card;
  const name = clean(card.name, 40) || "A neighbor";
  const parts: string[] = [];
  const reviews = Number(card.stats?.review_count ?? 0);
  const avg = card.stats?.avg_rating == null ? NaN : Number(card.stats.avg_rating);
  if (reviews > 0 && Number.isFinite(avg)) parts.push(`${avg.toFixed(1)} stars (${reviews} review${reviews === 1 ? "" : "s"})`);
  const done = Number(card.helpr?.jobs_done ?? 0);
  if (done > 0) parts.push(`${done} job${done === 1 ? "" : "s"} done`);
  // M1 (audit 11-05): the TRUE count (it read "24 items for sale" for a seller with 201), and skills and town lead.
  const selling = profileCount(card.listing_count, card.listings);
  if (selling > 0) parts.push(`${selling} item${selling === 1 ? "" : "s"} for sale`);
  const open = profileCount(card.job_count, card.jobs);
  if (open > 0) parts.push(`${open} open job${open === 1 ? "" : "s"}`);
  const skills = profileSkillsLine(card.skills);
  const town = clean(card.town, 60);
  const lead = skills ? `${skills}${town ? ` in ${town}` : ""}.` : town ? `${name} in ${town} on Louisiana Helpr.` : `See what ${name} posts and does on Louisiana Helpr.`;
  return {
    title: `${name} on Louisiana Helpr`,
    ogTitle: `${name} on Louisiana Helpr`,
    description: clean(`${lead}${parts.length ? ` ${parts.join(" · ")}.` : ""}`, 200),
    // og:url and the canonical name the current handle, not an old one the link still carries (L2).
    url: typeof card.handle === "string" && HANDLE_RE.test(card.handle) ? `${SITE_ORIGIN}/u/${card.handle}` : url,
    robots: card.show_in_search === true ? PROFILE_ROBOTS_SHOWN : PROFILE_ROBOTS,
    noindexHeader: card.show_in_search !== true,
    image: profileCardImage(typeof card.handle === "string" && HANDLE_RE.test(card.handle) ? card.handle : handle, card, name),
    cdnCache: PROFILE_CDN_CACHE,
    singleImage: true,
  };
}

/* ------------------------------------------------------------------ *
 * Matchmaker links (B59, 2026-10-29): /post-job?mm=1&cat=...&t=...
 * ------------------------------------------------------------------ */

/**
 * The card is built from the link's own query, never a database read: the
 * owner wrote those words in Admin -> Growth links. Each value goes through
 * clean() and escapeAttr like every other card value; the category is shown
 * humanised, the price only as whole dollars in range. Mirrors
 * src/lib/matchmakerLink.ts (which this server file cannot import).
 */
function metaForMatchmaker(params: URLSearchParams): Meta {
  const what = clean(params.get("t"), 80) || humaniseCategory(params.get("cat"));
  const town = clean(params.get("town"), 60);
  const priceRaw = params.get("price") ?? "";
  const price = /^\d{1,4}$/.test(priceRaw) && Number(priceRaw) >= 1 ? ` · $${Number(priceRaw)}` : "";
  const headline = clean(`Post this job: ${what}${town ? ` in ${town}` : ""}${price}`, 100);
  return {
    title: `${headline} — Helpr`,
    ogTitle: headline,
    description:
      "Tap to post it on Louisiana Helpr, already filled in. Local Helprs say yes, and the job is covered by the Helpr Guarantee.",
    url: `${SITE_ORIGIN}/post-job`,
    robots: "noindex, follow",
  };
}

function metaForUser(url: string): Meta {
  return {
    title: "Helpr profile",
    ogTitle: "View this Helpr's profile",
    description:
      "Profiles on Helpr are visible to members. Sign in or create a free account to see this Helpr's reviews, skills and availability.",
    url,
  };
}

/**
 * A public, indexable page (lh-seo-web SW-001 / SW-002, 2026-09-25).
 *
 * /browse, /help, /support and the Legal URLs used to get the homepage's
 * title, description, og:* and — worst — `<link rel=canonical>` pointing at
 * the homepage until JavaScript ran, which tells a non-JS crawler every one of
 * them is a duplicate of `/`. Their values come from the same table the SPA's
 * usePageMeta reads (src/lib/publicPageMeta.mjs), so pre-JS and post-JS agree
 * by construction. No database read; `null` (unknown page id) serves the
 * untouched shell, like every other "say nothing new" branch here.
 *
 * `id` is the path without its leading slash ("browse", "legal", "terms"), as
 * named by the vercel.json rewrite. `tab` is the visitor's own ?tab=, which
 * Vercel carries through the rewrite (the /signup ?ref= card relies on the
 * same behaviour); the Legal tab resolution is the page's own.
 */
function metaForPublicPage(id: string, tab: string | null, finder = false): Meta | null {
  // Search pages (owner 11-23, src/content/guideSearchPages.mjs): their own indexed head, before the generic noindex
  // head publicPageMetaFor gives any other /gift-guides/<slug>.
  const search = searchPageBySlug(giftGuideSlug(id) ?? "");
  const page = giftGuideHead(id) ?? (search ? searchPageMeta(search) : null) ?? publicPageMetaFor(`/${id}`, tab);
  if (!page) return null;
  const card = SECTION_CARDS[id];
  // A shared gift finder link (/gift-guides?who=her&budget=50, GiftGuideLanding finderAsked) previews as Find a gift.
  const cover = (finder && id === "gift-guides" ? wideCard("find-a-gift", "Find a gift from the Louisiana Helpr holiday gift guides") : undefined) ?? giftGuideCover(id, page.ogTitle);
  return {
    title: page.title,
    description: page.description,
    ogTitle: page.ogTitle,
    ogDescription: page.ogDescription,
    url: page.canonical,
    // A gift guide kept out of search (a hub, an empty or thin guide) says so before JS, as its page does after.
    ...("robots" in page && typeof page.robots === "string" ? { robots: page.robots } : {}),
    ...(card ? { image: { url: `${SITE_ORIGIN}${card.path}`, type: "image/png", width: 1200, height: 630, alt: card.alt } } : {}),
    ...(cover ? { image: cover } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * SEO P1 (owner 11-19): each page's own body, JSON-LD and real 404s
 * ------------------------------------------------------------------ */

/**
 * The gift guide data the build wrote (scripts/generated/seo-data.js, from src/prerender/seoData.ts). `null` when the
 * module is the empty placeholder (a test or a build without it): a guide URL then keeps today's behaviour, never a
 * wrong 404 for every guide.
 */
function seoData(): SeoData | null {
  const d = SEO_DATA as SeoData | undefined;
  return d && d.guides && Object.keys(d.guides).length > 0 ? d : null;
}

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * A shared wish list's link card (owner 2026-11-20; UX audit M1: it previewed as the generic Helpr card). The same card
 * for every list: it never reads the list or shows its name (a visitor's own words stay off our card), and it is
 * noindex in the head and the header. The gift guides' own collage is the picture.
 */
const WISH_LIST_CODE = /^[a-z0-9]{12}$/;
function metaForWishList(code: string): Meta {
  const ok = WISH_LIST_CODE.test(code);
  return {
    title: "A wish list — Helpr",
    ogTitle: "Someone shared their wish list with you",
    description: "See each gift on this holiday wish list and shop it, from the Louisiana Helpr gift guides.",
    url: ok ? `${SITE_ORIGIN}/gift-guides/list/${code}` : `${SITE_ORIGIN}/gift-guides`,
    robots: "noindex, nofollow",
    noindexHeader: true,
    // Owner 2026-11-22: the page's own "shared with you / Wish List" banner card (scripts/gift-guide-wide-og.py).
    image: wideCard("wish-list", "A shared holiday wish list from the Louisiana Helpr gift guides") ?? { url: `${SITE_ORIGIN}${GIFT_GUIDES_LANDING_OG}`, type: "image/jpeg", width: 1200, height: 630, alt: "Louisiana Helpr holiday gift guides" },
  };
}

/**
 * A Secret Santa reveal link (/gift-guides/secret-santa/<code>/<token>, holiday audit C7, 11-20): it previewed as the
 * marketplace homepage in iMessage, WhatsApp and Messenger, with an index,follow head and a homepage canonical. Its own
 * card now: never a name (the server is not asked; the giver and match are only shown after the page opens), noindex,
 * canonical to the link itself when the code and token have the right shape (else the drawer page).
 */
const SANTA_REVEAL_ID = /^([a-f0-9]{10})\/([a-f0-9]{64})$/;
function metaForSantaReveal(id: string): Meta {
  const m = SANTA_REVEAL_ID.exec(id);
  return {
    title: "Your Secret Santa match — Louisiana Helpr",
    ogTitle: "Your Secret Santa match is ready 🎁",
    description: "Tap to see who you're buying for. It's just for you, so don't forward it.",
    url: m ? `${SITE_ORIGIN}/gift-guides/secret-santa/${m[1]}/${m[2]}` : `${SITE_ORIGIN}/gift-guides/draw-names`,
    robots: "noindex, nofollow",
    noindexHeader: true,
    image: { url: `${SITE_ORIGIN}${GIFT_GUIDES_LANDING_OG}`, type: "image/jpeg", width: 1200, height: 630, alt: "Louisiana Helpr holiday gift guides" },
  };
}

/** My Wish List's page (owner 2026-11-20): an SPA page under /gift-guides/, noindex, never the unknown-guide 404 (UX audit H2). */
const MY_LIST_SLUG = "my-list";

/** The guide slug in a rewrite's id ("gift-guides/<one segment>"), or null. */
function giftGuideSlug(id: string): string | null {
  const m = /^gift-guides\/([^/]+)$/.exec(id);
  return m ? m[1] : null;
}

/**
 * A catalog guide's head with its own description (its first picks and count, as the page writes it after JS), and
 * for a guide kept out of search (a hub, an empty or thin guide) its noindex head. `null` for any other id.
 */
function giftGuideHead(id: string): ReturnType<typeof giftGuidePageMeta> | null {
  const slug = giftGuideSlug(id);
  const d = seoData();
  if (!slug || !d || !hasOwn(d.guides, slug)) return null;
  const g = d.guides[slug];
  // A guide out of search is named "<title> gift guide" in the data: the name giftGuidePageMeta builds from its title.
  return giftGuidePageMeta(slug, g.name.replace(/ gift guide$/, ""), g.picks.slice(0, 3).map((p) => p[0]), g.count);
}

type SeoOutcome =
  | { kind: "page"; body: string; jsonLd: unknown[] }
  | { kind: "notfound"; body: string }
  | { kind: "moved"; location: string }
  | null;

/**
 * Guide Q&A (owner pop-up 2026-11-22 9:40 PM: "Q&A + updated date + byline"): a page's questions as the section at the
 * end of its body and its FAQPage JSON-LD, with the page's Updated day (src/content/guideUpdated.mjs). The page draws
 * the same section from the same function (src/pages/info/giftGuides/GuideQa.tsx).
 */
function withQa(page: string, qa: QaItem[], byline: string): { section: string; ld: unknown[] } {
  const ld = faqPageLd(qa);
  return { section: qaSectionHtml(qa, hasOwn(GUIDE_UPDATED, page) ? GUIDE_UPDATED[page].day : undefined, byline), ld: ld ? [ld] : [] };
}

/** A deals day's questions, from the build's deals and Small Business Saturday rows (scripts/generated/seo-data.js). */
function dealDayQa(slug: string, kind: string, today: string): QaItem[] {
  const d = seoData();
  if (!d) return [];
  if (kind === "small-biz") return smallBizQa((d.smallBiz ?? []).map(([name, town, category, ships]) => ({ name, town, category, ships })), SMALL_BIZ_CATEGORIES);
  // The seo rows carry each card's real last day (its store code's end counted at build), and dealParts the day's code and
  // sale counts: the same three sections the page and the guides menu count (guide train p 11-23).
  // Owner pop-up 11-24: a steal (row field 8) is counted as a steal, as the page counts it (guideQa.mjs dealsDayQa).
  return dealsDayQa(slug, (d.deals ?? []).map(([item, , ends, event, brand, deal, , kind]) => ({ item, event, brand: brand ?? "", deal: deal ?? "", ...(ends ? { ends } : {}), ...(kind ? { kind } : {}) })), today, dealPartsOn(d.dealParts?.[slug], today));
}

const HOME_CRUMB = { name: "Louisiana Helpr", path: "/" };
const GUIDES_CRUMB = { name: "Holiday gift guides", path: "/gift-guides" };

/**
 * What a public page carries beyond its head: its body inside #root and its JSON-LD; or a 404 (an unknown guide, an
 * unknown service or town: never the homepage under a 200, which Google reads as a soft 404); or a 301 (an old guide
 * slug the page itself forwards). `null`: nothing new, the page is served as before.
 */
function seoFor(url: URL): SeoOutcome {
  const route = resolveRoute(url);
  if (!route || route.kind !== "page") return null;
  const id = route.id;
  if (id === "gift-guides") {
    const d = seoData();
    if (!d) return null;
    return { kind: "page", body: giftGuidesLandingBody(d.groups), jsonLd: [breadcrumbLd([HOME_CRUMB, GUIDES_CRUMB]), giftGuidesLandingLd(d.groups)] };
  }
  // The gift guides' fun pages (owner 2026-11-20: /gift-guides/swipe, /planner, /draw-names) are info pages, not guides.
  if (id.startsWith("gift-guides/") && !infoPageBody(`/${id}`)) {
    const slug = giftGuideSlug(id);
    // My Wish List: the page itself, with the noindex head publicOrGiftGuidePageMetaFor gives any unlisted guide slug.
    if (slug === MY_LIST_SLUG) return null;
    // The deals days (owner 2026-11-21: "like each day has its own section, no need to put them all in 1"): Black Friday,
    // Small Business Saturday and Cyber Monday are each their own page, no catalog guide: their own body, never a 404.
    // The old one-page address 301s to Black Friday (a #anchor never reaches the server; the page forwards one).
    if (slug === DEALS_SLUG) return { kind: "moved", location: `${SITE_ORIGIN}/gift-guides/${oldDealsTarget("")}` };
    const day = slug && isLiveGuide(slug) ? dealDay(slug) : null;
    if (day) {
      const today = louisianaDay(new Date());
      const line = day.kind === "deals" ? DEALS_WORDS.disclosure : day[eventPhase(day, today)];
      // Structured data 1121: a deals day carries an ItemList of its own cards still showing today. Seo bodies 1123: the
      // body lists the day's sections (Top deals, Discount codes, Sales; or Small Business Saturday's businesses) and the
      // ItemList names the same cards.
      const lists = day.kind === "deals" ? dealsDayOn(seoData(), day.id, today) : null;
      const list = lists ? dealsItemListLd(day.pageTitle, seoData()?.deals ?? [], today, day.id, lists) : null;
      const shops = day.kind === "small-biz" ? seoData()?.smallBiz : undefined;
      const qa = withQa(day.id, dealDayQa(day.id, day.kind, today), QA_BYLINE.other);
      return { kind: "page", body: withQaSection(dealsGuideBody(day.id, day.pageTitle, day.description, line, lists, shops), qa.section), jsonLd: [breadcrumbLd([HOME_CRUMB, GUIDES_CRUMB, { name: day.pageTitle, path: `/gift-guides/${day.id}` }]), ...(list ? [list] : []), ...qa.ld] };
    }
    const d = seoData();
    if (!d) return null;
    if (slug && hasOwn(d.guides, slug)) {
      const g = d.guides[slug];
      const today = louisianaDay(new Date());
      const crumbs = breadcrumbLd([HOME_CRUMB, GUIDES_CRUMB, { name: g.name, path: `/gift-guides/${slug}` }]);
      const qa = withQa(slug, g.qa?.length ? catalogGuideQa(slug, g.qa, today) : [], slug === "25-days-sponsors" ? QA_BYLINE.other : QA_BYLINE.gifts);
      return { kind: "page", body: withQaSection(giftGuideBody(slug, g), qa.section), jsonLd: [...(g.picks.length ? [crumbs, giftGuideItemListLd(slug, g, today)] : [crumbs]), ...qa.ld] };
    }
    // Search pages (owner 11-23, "add a lot of different searches"; src/content/guideSearchPages.mjs): a filtered view of
    // Her, Him or Kids with its own body, BreadcrumbList and ItemList (its picks from the build, by the page's matcher).
    const sp = slug ? searchPageBySlug(slug) : null;
    const spPicks = sp && d.searchPages && hasOwn(d.searchPages, sp.slug) ? d.searchPages[sp.slug] : null;
    if (sp && spPicks) {
      const parent = searchPageParent(sp);
      const crumbs = breadcrumbLd([HOME_CRUMB, GUIDES_CRUMB, ...(parent ? [{ name: SEARCH_GUIDE_NAMES[parent], path: `/gift-guides/${parent}` }] : []), { name: sp.h1, path: `/gift-guides/${sp.slug}` }]);
      const list = giftGuideItemListLd(sp.slug, { name: sp.h1, indexed: true, picks: spPicks, count: spPicks.length }, louisianaDay(new Date()));
      return { kind: "page", body: searchPageBody(sp, spPicks), jsonLd: [crumbs, list] };
    }
    // 1120: a merged guide's old slug 301s to its section ("healthcare#rns"); a folded store page to the landing page ("").
    if (slug && hasOwn(d.moved, slug) && /^([a-z0-9-]+(#[a-z0-9-]+)?)?$/.test(d.moved[slug])) return { kind: "moved", location: d.moved[slug] ? `${SITE_ORIGIN}/gift-guides/${d.moved[slug]}` : `${SITE_ORIGIN}/gift-guides` };
    return { kind: "notfound", body: notFoundBody("gift-guide") };
  }
  if (id.startsWith("hire/")) {
    const hire = /^hire\/([^/]+)\/([^/]+)$/.exec(id);
    const found = hire ? findTownPage(hire[1], hire[2]) : null;
    if (!found) return { kind: "notfound", body: notFoundBody("hire") };
    return { kind: "page", body: hireBody(found.service, found.town), jsonLd: [hireBreadcrumbLd(found.service, found.town)] };
  }
  // Louisiana Holiday Hub (owner-approved 2026-11-20): each page's list as plain HTML, an ItemList of the lights and an
  // Event per event with a confirmed 2026 date (src/lib/holidayHubSeo.mjs). "Today" is Louisiana's, so an event that is
  // over drops out of the body and the markup.
  if (id === "holidays" || id.startsWith("holidays/")) {
    const today = louisianaToday(new Date());
    const hubBody = holidayHubBody(`/${id}`, today);
    // Guide Q&A 11-22: the hub itself (not the hire page) ends with its questions.
    const qa = withQa("holidays", id === "holidays" ? holidayHubQa(HOLIDAY_LIGHTS, HOLIDAY_EVENTS, today) : [], QA_BYLINE.other);
    if (hubBody) return { kind: "page", body: withQaSection(hubBody, qa.section), jsonLd: [...(holidayHubLd(`/${id}`, today) ?? []), ...qa.ld] };
  }
  const path = `/${id}`;
  const body = infoPageBody(path, id === "25days" ? seoData()?.lineup : undefined);
  if (!body) return null;
  const crumbs = infoPageBreadcrumbLd(path);
  return { kind: "page", body, jsonLd: [...(crumbs ? [crumbs] : []), ...(id === "25days" ? [twentyFiveDaysEventLd()] : [])] };
}

/**
 * The shells index.html carries at the end of <body> on every route (the landing's hero, /login, /signup, and the
 * signed-in /home, /jobs, /messages, /declutter skeletons). Each is shown only on its own path by an inline script in
 * index.html and removed by src/main.tsx everywhere else, so on any other path it is dead weight to a person and, to a
 * crawler, the homepage's H1 and text on every URL (audit 11-18). A response keeps only its own path's shell; the
 * scripts and main.tsx already treat a missing shell as nothing to do (getElementById returns null). "/" is the
 * static index.html and keeps them all.
 */
const SHELL_FOR_PATH: Record<string, string> = {
  "/login": "lh-login-shell",
  "/signup": "lh-signup-shell",
  "/home": "lh-home-shell",
  "/jobs": "lh-jobs-shell",
  "/messages": "lh-messages-shell",
  "/declutter": "lh-declutter-shell",
};
const SHELL_BLOCK_RE = /[ \t]*<div id="(lh-[a-z]+-shell)" aria-hidden="true" inert data-lh-shell="start">[\s\S]*?<span data-lh-shell="end" hidden><\/span><\/div>\n?/g;

function withoutOtherShells(html: string, path: string | null): string {
  const keep = path !== null && hasOwn(SHELL_FOR_PATH, path) ? SHELL_FOR_PATH[path] : null;
  return html.replace(SHELL_BLOCK_RE, (block, id: string) => (id === keep ? block : ""));
}

/** The visitor's path for the route this function was sent (null: a route no shell is drawn for). */
function routePath(url: URL): string | null {
  const route = resolveRoute(url);
  if (!route) return null;
  if (route.kind === "signup") return "/signup";
  if (route.kind === "page" || route.kind === "noindex") return `/${route.id}`;
  return null;
}

/**
 * The site-wide LocalBusiness and Organization blocks belong to the homepage alone (owner 11-19: Organization on the
 * home page only; the LocalBusiness has no address or phone Google can use). Every page this function serves drops
 * them and keeps WebSite.
 */
const SITE_ENTITY_RE = /[ \t]*<script type="application\/ld\+json">\s*\{\s*"@context": "https:\/\/schema\.org",\s*"@type": "(?:LocalBusiness|Organization)"[\s\S]*?<\/script>\n?/g;
function withoutSiteEntities(html: string): string {
  return html.replace(SITE_ENTITY_RE, "");
}

/** The page's own JSON-LD, right before </head>. */
function withJsonLd(html: string, blocks: unknown[]): string {
  if (!blocks.length) return html;
  const tags = blocks.map((b) => jsonLdScript(b)).join("\n");
  return html.replace("</head>", () => `${tags}\n</head>`);
}

/** A body first inside #root (React's createRoot replaces it on its first render). */
function withRootBody(html: string, body: string): string {
  return html.replace(/<div id="root"[^>]*>/, (open) => `${open}${body}`);
}

/**
 * A gift guide's link card is its own cover (owner-approved 2026-11-18): public/gift-guides/og/<slug>.jpg (600x600
 * JPEG, 11-18 PM), else the 480x480 WebP cover public/gift-guides/covers/<slug>.webp, else the shell's brand card (never
 * a broken image). Which files exist comes from src/lib/giftGuideShareImages.mjs (a slug list kept two-way with the
 * folders), so no image folder is bundled into this function. The slug is the rewrite's single path segment, re-checked here.
 * Guard: src/test/giftGuideSharePreview.test.ts.
 */
const GIFT_GUIDES_LANDING_OG = "/gift-guides/og/landing.jpg?v=5";

/**
 * Owner 2026-11-22 ("Fix the preview on these links": her Facebook post of /gift-guides/her came out as a SMALL square
 * thumbnail beside the title, because the guide's og:image was its 600x600 cover; the landing's 1200x630 card gets the
 * big card). Every gift guides page with its own head shares a 1200x630 card in its banner's style: the gingham, the
 * cream arch with its lead and title, LOUISIANA HELPR; only Her, Him and Kids add their cover's six gifts (owner
 * 2026-11-22, 10:15 PM: every other page "shows just its gingham and arch with the words, no items")
 * (scripts/gift-guide-wide-og.py, public/gift-guides/og-wide/<key>.jpg). ?v= is the file's content hash
 * (src/lib/giftGuideWideOg.mjs, written by the script), so a redrawn card is a new URL to Facebook's cache.
 * Guards: src/test/giftGuideWideOg1122.test.ts, src/test/giftGuideWideOgCoversOnly1122.test.ts.
 */
const WIDE_CARD_FOR_ID: Record<string, string> = {
  "gift-guides/her": "her",
  "gift-guides/him": "him",
  "gift-guides/kids": "kids",
  "gift-guides/monster-jam": "monster-jam",
  "gift-guides/bluey": "bluey",
  "gift-guides/marvel": "marvel",
  "gift-guides/kpop-demon-hunters": "kpop-demon-hunters",
  "gift-guides/pokemon": "pokemon",
  "gift-guides/minecraft": "minecraft",
  "gift-guides/hot-wheels": "hot-wheels",
  "gift-guides/cars": "cars",
  "gift-guides/25-days-sponsors": "25-days-sponsors",
  "gift-guides/black-friday": "black-friday",
  "gift-guides/cyber-monday": "cyber-monday",
  "gift-guides/small-business-saturday": "small-business-saturday",
  "gift-guides/printables/gift-tags": "gift-tags",
  "gift-guides/printables/coloring-books": "coloring-books",
  "gift-guides/printables/banners": "banners",
  "gift-guides/swipe": "swipe",
  "gift-guides/draw-names": "draw-names",
  "gift-guides/planner": "planner",
  "gift-guides/my-list": "my-list",
  holidays: "holidays",
};
const WIDE_ALT: Record<string, string> = {
  "gift-tags": "Free printable Christmas gift tags with names from Louisiana Helpr",
  "coloring-books": "Free printable Christmas coloring books from Louisiana Helpr",
  banners: "Free printable holiday banners from Louisiana Helpr",
};
function wideCard(key: string, alt: string): Meta["image"] | undefined {
  const v = hasOwn(WIDE_OG_VERSIONS, key) ? WIDE_OG_VERSIONS[key] : undefined;
  if (!v) return undefined;
  return { url: `${SITE_ORIGIN}/gift-guides/og-wide/${key}.jpg?v=${v}`, type: "image/jpeg", width: 1200, height: 630, alt: WIDE_ALT[key] ?? alt };
}

function giftGuideCover(id: string, name: string): Meta["image"] | undefined {
  const wide = hasOwn(WIDE_CARD_FOR_ID, id) ? wideCard(WIDE_CARD_FOR_ID[id], name) : undefined;
  if (wide) return wide;
  // The landing's own card (holistic review 11-18 M7: it shared the generic logo card): a 1200x630 card of the three live
  // covers (holiday audit 1121; scripts/gift-guide-landing-og.py), public/gift-guides/og/landing.jpg (<=150 KB). ?v= is the cache bust: bump it when the art changes.
  // Owner 2026-11-22: the landing's link preview is her plaid holiday gift guides card (public/gift-guides/landing-plaid-v5.jpg,
  // 1200x630); a new filename so Facebook's cache takes it. The wish-list and Secret Santa pages keep the collage above.
  if (id === "gift-guides") return { url: `${SITE_ORIGIN}/gift-guides/landing-plaid-v5.jpg`, type: "image/jpeg", width: 1200, height: 630, alt: "Holiday gift guides from Louisiana Helpr" };
  // Each printables page's own 1200x630 card (owner 2026-11-21: each its own page; scripts/printables-og-cards.py).
  if (id === "gift-guides/printables/gift-tags") return { url: `${SITE_ORIGIN}/printables/og-printables.jpg?v=1`, type: "image/jpeg", width: 1200, height: 630, alt: "Free printable Christmas gift tags with names from Louisiana Helpr" };
  if (id === "gift-guides/printables/coloring-books") return { url: `${SITE_ORIGIN}/printables/og-coloring-books.jpg?v=1`, type: "image/jpeg", width: 1200, height: 630, alt: "Free printable Christmas coloring books from Louisiana Helpr" };
  if (id === "gift-guides/printables/banners") return { url: `${SITE_ORIGIN}/printables/og-banners.jpg?v=1`, type: "image/jpeg", width: 1200, height: 630, alt: "Free printable Happy Thanksgiving and Merry Christmas banners from Louisiana Helpr" };
  const slug = /^gift-guides\/([a-z0-9-]+)$/.exec(id)?.[1];
  if (!slug) return undefined;
  // The deals days' own card (owner 2026-11-19), drawn by scripts/gift-guide-deals-cover.py; Small Business Saturday
  // takes the generic card.
  if (dealDay(slug)?.kind === "deals") return { url: `${SITE_ORIGIN}/gift-guides/deals/${DEALS_SLUG}.jpg`, type: "image/jpeg", width: 600, height: 600, alt: name };
  // The free printables page's own 1200x630 card (owner 2026-11-20): three gift tags with names on the gingham.
  if (slug === "printables") return { url: `${SITE_ORIGIN}/printables/og-printables.jpg?v=1`, type: "image/jpeg", width: 1200, height: 630, alt: "Free printable Christmas gift tags with names from Louisiana Helpr" };
  // The share JPG first (600x600 JPEG, the format every link-preview crawler takes), then the WebP cover.
  // ?v= is each file's content hash (scripts/gift-guide-cover-versions.mjs), so a redrawn card is a new URL to crawlers.
  const v = (h: string | undefined) => (h ? `?v=${h}` : "");
  if (OG_JPG_SLUGS.has(slug)) return { url: `${SITE_ORIGIN}/gift-guides/og/${slug}.jpg${v(OG_VERSIONS[slug])}`, type: "image/jpeg", width: 600, height: 600, alt: name };
  if (COVER_WEBP_SLUGS.has(slug)) return { url: `${SITE_ORIGIN}/gift-guides/covers/${slug}.webp${v(COVER_VERSIONS[slug])}`, type: "image/webp", width: 480, height: 480, alt: name };
  return undefined;
}

/**
 * A section page's own link card (owner 10-31, "Fix this": a shared /declutter link previewed in iMessage as the bare
 * H mark, twice, cut off, titled only "Declutter on Louisiana Helpr"). Each file is exactly 1200x630 (1.91:1): the
 * mark centred on its own background, the section's name and one line under it; never a square mark stretched or
 * tiled. Rendered from local files by ~/.lh-shots/b53/og/make.mjs. ?v= is the cache bust: bump it when the art
 * changes. Guard: src/test/sectionShareCards.test.ts.
 */
/** The 25 Days card for people entering (owner 2026-11-19); the brand card (SPONSOR_CARD) stays on /sponsor. */
const ENTRANT_CARD = { path: "/og-25days-enter.png?v=1", alt: "Free to enter: 25 Days of Louisiana Giveaways on Louisiana Helpr, December 1–25" };
const SECTION_CARDS: Record<string, { path: string; alt: string }> = {
  declutter: { path: "/og-declutter.png?v=1", alt: "Declutter on Louisiana Helpr: used things for sale from your Louisiana neighbors" },
  browse: { path: "/og-browse.png?v=1", alt: "Local jobs on Louisiana Helpr: hire help or find work near you" },
  // 25 Days went public and indexed on 11-19 (owner decision). Owner 2026-11-19: /25days is for people entering, so
  // its card says "Free to enter" and louisianahelpr.com/25days (public/og-25days-enter.png, 1200x630).
  "25days": ENTRANT_CARD,
};

/**
 * A public page that is deliberately NOT indexed (Q401a): /login, /signup,
 * /forgot-password, /reset-password, /signup-pending, /account-banned. Before
 * this they got the homepage's title and canonical and the shell's
 * "index, follow" until JS ran. Same table the pages' usePageMeta reads
 * (NOINDEX_PAGE_META), so pre-JS and post-JS agree; `null` for an unknown id
 * serves the untouched shell. No database read.
 */
function metaForNoindexPage(id: string): Meta | null {
  const page = noindexPageMetaFor(`/${id}`);
  if (!page) return null;
  const card = NOINDEX_CARDS[id];
  return {
    title: page.title,
    description: page.description,
    ogTitle: page.ogTitle,
    ogDescription: page.ogDescription,
    url: page.canonical,
    robots: page.robots,
    // 1200x630, the size public/og-25days.png is (checked by src/test/sponsor25days.test.tsx).
    ...(card ? { image: { url: SITE_ORIGIN + card.path, type: "image/png", width: 1200, height: 630, alt: card.alt } } : {}),
  };
}

/**
 * A not-indexed page's own link card. The 25 Days sponsor page (owner 2026-11-09) is sent to brands in pitch
 * emails, so its link must unfurl as its own 1200x630 picture (public/og-25days.png), not the homepage's.
 */
const SPONSOR_CARD = { path: "/og-25days.png?v=2", alt: "You're Invited! 25 Days of Louisiana Giveaways on Louisiana Helpr, December 1–25" };
const NOINDEX_CARDS: Record<string, { path: string; alt: string }> = {
  sponsor: SPONSOR_CARD,
  "25days": ENTRANT_CARD,
};

/**
 * Which route is being previewed.
 *
 * The rewrites in vercel.json name the route explicitly
 * (`/jobs/:id` -> `/api/share?_og=job&_id=:id`) rather than leaving this
 * function to infer it from the path. After a platform rewrite the path a
 * function observes is the DESTINATION (`/api/share`), not what the visitor
 * typed, and that detail is not something to bet a user-facing route on.
 * Naming it in the destination is explicit and cannot drift.
 *
 * Pathname parsing is kept as a fallback so the handler is still correct when
 * invoked directly with a real route path — which is how the local harness and
 * the unit-style checks exercise it.
 */
function resolveRoute(url: URL): { kind: "job" | "signup" | "user" | "page" | "noindex" | "shop" | "declutter" | "book" | "matchmaker" | "profile" | "wishlist" | "santa"; id: string } | null {
  const declared = url.searchParams.get("_og");
  if (declared === "job" || declared === "user" || declared === "page" || declared === "noindex" || declared === "shop" || declared === "declutter" || declared === "book" || declared === "profile") {
    return { kind: declared, id: url.searchParams.get("_id") ?? "" };
  }
  if (declared === "signup") return { kind: "signup", id: "" };
  if (declared === "matchmaker") return { kind: "matchmaker", id: "" };
  if (declared === "wishlist") return { kind: "wishlist", id: url.searchParams.get("_id") ?? "" };
  if (declared === "santa") return { kind: "santa", id: `${url.searchParams.get("_code") ?? ""}/${url.searchParams.get("_tok") ?? ""}` };

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
  if (jobMatch) return { kind: "job", id: decodeURIComponent(jobMatch[1]) };
  if (pathname === "/signup") return { kind: "signup", id: "" };
  const itemMatch = pathname.match(/^\/declutter\/item\/([^/]+)$/);
  if (itemMatch) return { kind: "declutter", id: decodeURIComponent(itemMatch[1]) };
  const bookMatch = pathname.match(/^\/book\/([^/]+)$/);
  if (bookMatch) return { kind: "book", id: decodeURIComponent(bookMatch[1]) };
  const profileMatch = pathname.match(/^\/u\/([^/]+)$/);
  if (profileMatch) return { kind: "profile", id: decodeURIComponent(profileMatch[1]) };
  const shopMatch = pathname.match(/^\/shops\/([^/]+)$/);
  if (shopMatch) return { kind: "shop", id: decodeURIComponent(shopMatch[1]) };
  const userMatch = pathname.match(/^\/user\/([^/]+)$/);
  if (userMatch) return { kind: "user", id: decodeURIComponent(userMatch[1]) };
  if (publicPageMetaFor(pathname, null)) return { kind: "page", id: pathname.slice(1) };
  if (noindexPageMetaFor(pathname)) return { kind: "noindex", id: pathname.slice(1) };
  return null;
}

/** Ids reach og:url, so only ever echo a shape we recognise. */
function safeIdSegment(id: string): string {
  return UUID_RE.test(id) ? id : "";
}

async function resolveMeta(url: URL): Promise<Meta | null> {
  const route = resolveRoute(url);
  if (!route) return null;

  if (route.kind === "job") {
    const seg = safeIdSegment(route.id);
    const canonical = seg ? `${SITE_ORIGIN}/jobs/${seg}` : `${SITE_ORIGIN}/jobs`;
    return metaForJob(route.id, canonical);
  }

  if (route.kind === "shop") {
    const seg = safeIdSegment(route.id);
    return metaForShop(route.id, seg ? `${SITE_ORIGIN}/shops/${seg}` : `${SITE_ORIGIN}/shops`);
  }

  if (route.kind === "matchmaker") {
    return metaForMatchmaker(url.searchParams);
  }

  if (route.kind === "wishlist") {
    return metaForWishList(route.id);
  }

  if (route.kind === "santa") {
    return metaForSantaReveal(route.id);
  }

  if (route.kind === "book") {
    const seg = safeIdSegment(route.id);
    return metaForBook(route.id, seg ? `${SITE_ORIGIN}/book/${seg}` : `${SITE_ORIGIN}/`);
  }

  if (route.kind === "profile") {
    const h = route.id.trim().toLowerCase();
    return metaForProfile(route.id, HANDLE_RE.test(h) ? `${SITE_ORIGIN}/u/${h}` : `${SITE_ORIGIN}/`);
  }

  if (route.kind === "declutter") {
    const seg = safeIdSegment(route.id);
    return metaForDeclutterItem(route.id, seg ? `${SITE_ORIGIN}/declutter/item/${seg}` : `${SITE_ORIGIN}/declutter`);
  }

  if (route.kind === "signup") {
    return metaForSignup(url.searchParams.get("ref"));
  }

  if (route.kind === "page") {
    return metaForPublicPage(route.id, url.searchParams.get("tab"), url.searchParams.has("who"));
  }

  if (route.kind === "noindex") {
    return metaForNoindexPage(route.id);
  }

  const seg = safeIdSegment(route.id);
  // H5: a signed-out visitor to /user/<id> forwards to /u/<handle>, so the card is that page's; without a public page
  // the members-only card stays.
  if (seg) {
    const u = await profileCardForUserId(seg);
    if (u !== "absent" && u !== "unknown") return u;
  }
  return metaForUser(seg ? `${SITE_ORIGIN}/user/${seg}` : `${SITE_ORIGIN}/login`);
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

/**
 * The page's own text inside #root, for the pages that must be readable with no JavaScript (/terms/full,
 * /privacy/full, /sms-opt-in; owner/lead 2026-10-23, Twilio's A2P checker). The markup is built from the app's own
 * components at build time (src/prerender/staticPages.tsx via scripts/prerender-static-pages.mjs). Every visitor
 * gets the same document, so this is not cloaking; with JavaScript, React's createRoot replaces #root's children on
 * its first render. Any other page, or a shell without the anchor (build-og-shell.mjs asserts it), is unchanged.
 */
function withStaticBody(html: string, url: URL): string {
  const route = resolveRoute(url);
  if (!route || route.kind !== "page") return html;
  const bodies = STATIC_PAGE_BODIES as Record<string, string>;
  const key = `/${route.id}`;
  const body = Object.prototype.hasOwnProperty.call(bodies, key) ? bodies[key] : null;
  if (!body) return html;
  return html.replace(/<div id="root"[^>]*>/, (open) => `${open}${body}`);
}

/**
 * /browse's first job cards in the raw HTML (PERF-SHELL, Q652; lead decision 11-01): a guest's first screen used to
 * wait ~4 s on Slow 4G for the whole app before any card painted. The rows come from the same anon read of the
 * masked open_jobs_browse view the guest feed makes (browseShellRowsUrl: the feed's payment_status, order and limit,
 * only the columns src/lib/browseShellCards.mjs draws from); it picks, checks and renders the open ones (title, category,
 * town, take-home; nothing else). A read that succeeds with no live row draws the feed's own empty state instead
 * (Q2705: with no job open, that sentence was the LCP at ~4.6 s). A slow or failed read serves the page exactly as
 * before (null rows draw nothing), and its budget is short because this read sits in front of the HTML on a CDN miss.
 */
const BROWSE_SHELL_TIMEOUT_MS = 700;
/** Shorter than the default: a filled job must leave the HTML within minutes (the app replaces the cards anyway). */
const BROWSE_SHELL_CDN_CACHE = "public, s-maxage=120, stale-while-revalidate=600";

/**
 * /browse's own inlined block (the overlay's subset of the app sheet and its show rule; withBrowseShellCss), written by
 * scripts/build-og-shell.mjs from the build. Read off the module namespace: a snapshot written without a build
 * (src/test/helpers/ogShellSnapshot.ts) has none, and then /browse keeps the page's block as it was.
 */
const BROWSE_SHELL_CSS: string | null = (() => {
  const css = (ogShellModule as Record<string, unknown>).BROWSE_SHELL_CSS;
  return typeof css === "string" ? css : null;
})();

async function fetchBrowseShellRows(): Promise<unknown[] | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Accept: "application/json" };
  try {
    // The view hides seed and test jobs only while seed_hidden_in_discovery() says so, and it does not expose
    // is_seed: ask that switch beside the rows, and draw cards only on an exact `true` (shellRowsWhenSeedsHidden).
    const [res, seeds] = await Promise.all([
      fetch(browseShellRowsUrl(SUPABASE_URL), { headers, signal: AbortSignal.timeout(BROWSE_SHELL_TIMEOUT_MS) }),
      // GET: PostgREST serves a STABLE function on GET, so this stays a plain read like the rows.
      fetch(browseShellSeedsHiddenUrl(SUPABASE_URL), { headers, signal: AbortSignal.timeout(BROWSE_SHELL_TIMEOUT_MS) }),
    ]);
    if (!res.ok || !seeds.ok) return null;
    const [rows, seedsHidden] = (await Promise.all([res.json(), seeds.json()])) as [unknown, unknown];
    return shellRowsWhenSeedsHidden(Array.isArray(rows) ? rows : null, seedsHidden);
  } catch {
    // Timeout or network: the page is served without cards, exactly as before this existed.
    return null;
  }
}

function isBrowsePage(url: URL): boolean {
  const route = resolveRoute(url);
  return !!route && route.kind === "page" && route.id === "browse";
}

/**
 * /declutter's first-row card photos preloaded from the response's Link header (Q2705, lead 11-08;
 * src/lib/declutterFirstPhotos.mjs): the photos start with the HTML instead of after index.html's guest script has read
 * the preview. The same anon preview read a guest's browser makes; the HTML itself is unchanged (no path in the
 * markup). A slow or failed read serves the page exactly as before (no header). Short budget: this read sits in front
 * of the HTML on a CDN miss.
 */
const DECLUTTER_PHOTOS_TIMEOUT_MS = 700;
/**
 * A sold or withdrawn item's photo leaves the header within a minute of traffic; a quiet hour may serve one stale
 * header while the CDN refreshes (that costs one unused photo download, never a wrong card: the page draws from its own
 * read). The longer stale-while-revalidate keeps a cold visit from waiting on the preview read before any HTML.
 */
const DECLUTTER_PAGE_CDN_CACHE = "public, s-maxage=60, stale-while-revalidate=3600";

async function fetchDeclutterFirstPhotos(): Promise<string[] | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, Accept: "application/json" };
  try {
    const res = await fetch(declutterGuestPreviewUrl(SUPABASE_URL), { headers, signal: AbortSignal.timeout(DECLUTTER_PHOTOS_TIMEOUT_MS) });
    if (!res.ok) return null;
    return firstPhotoPaths(await res.json());
  } catch {
    // Timeout, network or a body that is not JSON: the page is served without the tag, exactly as before.
    return null;
  }
}

function isDeclutterPage(url: URL): boolean {
  const route = resolveRoute(url);
  return !!route && route.kind === "page" && route.id === "declutter";
}

/** A 404's document: its own head (noindex), none of the shells, and a body that says so and links somewhere useful. */
function notFoundPage(body: string): string {
  const shell = withoutSiteEntities(withoutOtherShells(absolutiseIconLinks(SHELL_HTML), null));
  const head = applyMeta(shell, {
    title: "Page not found — Louisiana Helpr",
    ogTitle: "Page not found",
    description: "We couldn't find that page on Louisiana Helpr. See holiday gift guides, Declutter and local jobs.",
    url: `${SITE_ORIGIN}/`,
    robots: "noindex, follow",
  });
  // Technical SEO audit TS16 (1123): a 404 names no canonical (a noindex page pointing at the homepage is a mixed signal).
  return withRootBody(head.replace(/<link rel="canonical" href="[^"]*">\s*/, ""), body);
}

/** An old guide link: 301 to the guide it is now (absolute, on SITE_ORIGIN; never built from the request's Host). */
function movedPermanently(location: string): Response {
  return new Response(null, {
    status: 301,
    headers: { Location: location, "Vercel-CDN-Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
  });
}

function respond(html: string, cdnCache: string = "public, s-maxage=300, stale-while-revalidate=86400", status = 200, noindex = false, extra: Record<string, string> = {}): Response {
  return new Response(html, {
    status,
    headers: {
      ...extra,
      // Q2393: an unknown URL is the same shell (the app renders its Not Found
      // page) but answers 404 and is never indexed. L7: a /u page unless its member opted in.
      ...(status === 404 || noindex ? { "X-Robots-Tag": "noindex" } : {}),
      "Content-Type": "text/html; charset=utf-8",
      // Browser caching is left to the site-wide `Cache-Control` rule in
      // vercel.json so this response behaves exactly like the static shell.
      // `Vercel-CDN-Cache-Control` is CDN-only and is not set by that rule, so
      // it adds edge caching without colliding with it — crawlers re-scraping
      // a popular job don't each cost a database round trip.
      "Vercel-CDN-Cache-Control": cdnCache,
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    // Any failure — database down, timeout, unexpected shape — falls back to
    // the unmodified shell. That is exactly today's behaviour, so the worst
    // case of this feature is the status quo, never a broken page.
    try {
      const url = new URL(request.url);
      // Q2393: vercel.json sends every path App.tsx does not declare here. The
      // SPA still renders its Not Found page; crawlers see a real 404.
      if (url.searchParams.get("_og") === "notfound") return respond(notFoundPage(notFoundBody()), undefined, 404);
      // SEO P1 (owner 11-19): an unknown guide, service or town is a real 404 with a helpful page, an old guide slug a
      // 301 to its guide now (the page forwards it too), never the homepage under a 200.
      const seo = seoFor(url);
      if (seo?.kind === "moved") return movedPermanently(seo.location);
      if (seo?.kind === "notfound") return respond(notFoundPage(seo.body), undefined, 404);
      const meta = await resolveMeta(url);
      // Only this path's own shell, and no homepage-only JSON-LD (SEO P1; see withoutOtherShells).
      const shell = withoutSiteEntities(withoutOtherShells(absolutiseIconLinks(SHELL_HTML), routePath(url)));
      // L7: a /u page whose card could not be read fails closed (noindex), like every other unknown.
      if (!meta) return respond(shell, undefined, 200, resolveRoute(url)?.kind === "profile");
      // A shop card goes stale within minutes, never a day: a shop hidden,
      // paused or closed must stop previewing (lh-authz-rls should-fix 2).
      // A Declutter item card likewise: sold or withdrawn stops previewing (Q2426).
      const withMeta = withStaticBody(applyMeta(shell, meta), url);
      // SEO P1: the page's own body (H1, intro, picks or links, breadcrumb) and JSON-LD.
      const page = seo?.kind === "page" ? withJsonLd(withRootBody(withMeta, seo.body), seo.jsonLd) : withMeta;
      if (isBrowsePage(url)) return respond(withBrowseShell(page, await fetchBrowseShellRows(), Date.now(), BROWSE_SHELL_CSS), BROWSE_SHELL_CDN_CACHE);
      if (isDeclutterPage(url)) {
        const preload = declutterPhotoPreloadHeader(SUPABASE_URL, await fetchDeclutterFirstPhotos());
        return respond(page, DECLUTTER_PAGE_CDN_CACHE, 200, meta.noindexHeader === true, preload ? { Link: preload } : {});
      }
      return respond(page, meta.cdnCache, 200, meta.noindexHeader === true);
    } catch {
      // Silence is the contract here: an OG-meta lookup that fails must
      // degrade to the plain shell, never to a broken share page. The
      // shell has the default tags, so the reader loses nothing but a
      // job-specific preview.
      //
      // Through absolutiseIconLinks, though, not the raw shell: this branch
      // was the one door left open on VN-4. Measured 2026-09-21 —
      // `/jobs/%ZZ` (decodeURIComponent throws on a malformed escape, which
      // resolveRoute does not catch) answered 200 with the icons
      // root-relative, i.e. the OS share sheet's compass again, and
      // src/test/shareIconLinks.test.ts never looked at this path. The
      // rewrite is pure and idempotent, so degrading still costs a reader
      // nothing but the job-specific preview.
      return respond(absolutiseIconLinks(SHELL_HTML), undefined, isNotFoundRequest(request) ? 404 : 200, isProfileRequest(request));
    }
  },
};

/** L7: a /u/<handle> request (the profile rewrite), read without throwing; it fails closed to noindex. */
function isProfileRequest(request: Request): boolean {
  return /[?&]_og=profile(?:&|$)/.test(request.url) || /^https?:\/\/[^/]+\/u\//.test(request.url);
}

/** Q2393: the catch-all's rewrite, read without throwing (the catch above uses it). */
function isNotFoundRequest(request: Request): boolean {
  return /[?&]_og=notfound(?:&|$)/.test(request.url);
}
