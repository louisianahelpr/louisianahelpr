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
 *     therefore excluded here on purpose — see the note on jobDescription().
 */

import { SHELL_HTML } from "../scripts/generated/og-shell.js";
import { STATIC_PAGE_BODIES } from "../scripts/generated/static-pages.js";
import { noindexPageMetaFor, publicPageMetaFor } from "../src/lib/publicPageMeta.mjs";

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
   * SH2b shop cards only: the shop's own photo. Applied as VALUES on the FIRST
   * og:image block (url, type, width, height, alt) and twitter:image; no tag
   * is added, removed or reordered, so the positional binding index.html
   * relies on holds. Omitted everywhere else: those cards keep the H mark.
   */
  image?: { url: string; type: string; width: number; height: number; alt: string };
  /** CDN cache override (shop cards: minutes, so a hidden or paused shop stops previewing). */
  cdnCache?: string;
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
 * global: og:image appears twice by design, and while this function never
 * targets it, a global replace is the kind of thing that quietly becomes
 * wrong later.
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
  const columns = "id,title,category,budget,location,date_needed,pricing_mode,expires_at,photos";
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
 * `date_needed` is a bare YYYY-MM-DD. Formatting it in the server's local zone
 * would slide it a day either way, so pin the format to UTC.
 */
function formatDate(dateNeeded: string | null): string {
  if (!dateNeeded || !/^\d{4}-\d{2}-\d{2}$/.test(dateNeeded)) return "";
  const parsed = new Date(`${dateNeeded}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

function formatBudget(job: PublicJob): string {
  if (job.pricing_mode !== "set_price") return "";
  const budget = typeof job.budget === "number" ? job.budget : Number(job.budget);
  if (!Number.isFinite(budget) || budget <= 0) return "";
  return Number.isInteger(budget) ? `$${budget}` : `$${budget.toFixed(2)}`;
}

/**
 * The card body for a job.
 *
 * Composed from structured, already-public fields rather than the job's
 * free-text `description`. The description is anon-readable and the guest page
 * renders it, but it is the one field a customer can type a street address or
 * a gate code into — and unlike the page, this string gets cached by third
 * parties indefinitely and shown to people who never open the link. A
 * structured line is both safer and reads better on a card.
 *
 * (Note for whoever owns src/pages/jobs/JobDetail.tsx: `usePageMeta` there does put
 * the raw description into og:description. Today that reaches nobody, because
 * crawlers don't run the SPA — but it does reach a JS-executing crawler like
 * Googlebot. Worth a look; it is outside this lane.)
 */
function jobDescription(job: PublicJob): string {
  const parts: string[] = [];
  const city = clean(job.location, 60);
  const category = humaniseCategory(job.category);
  parts.push(city ? `${category} job in ${city}` : `${category} on Helpr`);
  const when = formatDate(job.date_needed);
  if (when) parts.push(`needed ${when}`);
  const budget = formatBudget(job);
  if (budget) parts.push(budget);
  return `${parts.join(" · ")}. Payment is held safely until the work is confirmed done.`;
}

/**
 * A job id that resolves to nothing — deleted, filled, expired, or simply
 * never existed. It must NOT produce a confident card for a job that isn't
 * there. The honest card says so; the page underneath renders its real
 * "job not found" empty state with a route back to Browse.
 */
function unavailableJobMeta(url: string): Meta {
  return {
    title: "This job is no longer available — Helpr",
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

/** "Free" for $0 (the Free section), else "$25" / "$12.50": the app's own itemPriceLabel wording. */
function itemCardPrice(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "Free";
  const dollars = cents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}

/**
 * The cover at exactly 1200x630 through shop-photo kind=declutter (by photo
 * ID, never by storage path: the path starts with the seller's user id, and
 * this URL sits in third-party preview caches for good). The function
 * re-checks the item is link-visible on every fetch.
 */
function itemImage(item: PublicItemCard, title: string): Meta["image"] | undefined {
  const id = item.photo_id;
  if (typeof id !== "string" || !UUID_RE.test(id) || !SUPABASE_URL) return undefined;
  return {
    url: `${SUPABASE_URL}/functions/v1/shop-photo?id=${id}&kind=declutter&w=1200&og=1`,
    type: "image/jpeg",
    width: 1200,
    height: 630,
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
  const title = clean(item.title, 80);
  if (!title) return unavailableItemMeta(url);
  const price = itemCardPrice(item.price_cents);
  const town = clean(item.area_label, 80);
  return {
    title: `${title} — Helpr`,
    // Facebook shows og:title in bold on the card: the price rides on it so it is seen at a glance.
    ogTitle: clean(`${title} · ${price}`, 100),
    description: clean(
      `${price}${town ? ` · ${town}` : ""}. From a neighbor on Louisiana Helpr: pay in the app, pick it up nearby.`,
      200,
    ),
    url,
    robots: DECLUTTER_ITEM_ROBOTS,
    image: itemImage(item, title),
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
    description: clean(jobDescription(job), 200),
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
 * removed job stops serving its photo. No photo: no image block (the shell's own card image stays).
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
function metaForPublicPage(id: string, tab: string | null): Meta | null {
  const page = publicPageMetaFor(`/${id}`, tab);
  if (!page) return null;
  const card = SECTION_CARDS[id];
  return {
    title: page.title,
    description: page.description,
    ogTitle: page.ogTitle,
    ogDescription: page.ogDescription,
    url: page.canonical,
    ...(card ? { image: { url: `${SITE_ORIGIN}${card.path}`, type: "image/png", width: 1200, height: 630, alt: card.alt } } : {}),
  };
}

/**
 * A section page's own link card (owner 10-31, "Fix this": a shared /declutter link previewed in iMessage as the bare
 * H mark, twice, cut off, titled only "Declutter on Louisiana Helpr"). Each file is exactly 1200x630 (1.91:1): the
 * mark centred on its own background, the section's name and one line under it; never a square mark stretched or
 * tiled. Rendered from local files by ~/.lh-shots/b53/og/make.mjs. ?v= is the cache bust: bump it when the art
 * changes. Guard: src/test/sectionShareCards.test.ts.
 */
const SECTION_CARDS: Record<string, { path: string; alt: string }> = {
  declutter: { path: "/og-declutter.png?v=1", alt: "Declutter on Louisiana Helpr: used things for sale from your Louisiana neighbors" },
  browse: { path: "/og-browse.png?v=1", alt: "Local jobs on Louisiana Helpr: hire help or find work near you" },
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
  return {
    title: page.title,
    description: page.description,
    ogTitle: page.ogTitle,
    ogDescription: page.ogDescription,
    url: page.canonical,
    robots: page.robots,
  };
}

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
function resolveRoute(url: URL): { kind: "job" | "signup" | "user" | "page" | "noindex" | "shop" | "declutter" | "book" | "matchmaker"; id: string } | null {
  const declared = url.searchParams.get("_og");
  if (declared === "job" || declared === "user" || declared === "page" || declared === "noindex" || declared === "shop" || declared === "declutter" || declared === "book") {
    return { kind: declared, id: url.searchParams.get("_id") ?? "" };
  }
  if (declared === "signup") return { kind: "signup", id: "" };
  if (declared === "matchmaker") return { kind: "matchmaker", id: "" };

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
  if (jobMatch) return { kind: "job", id: decodeURIComponent(jobMatch[1]) };
  if (pathname === "/signup") return { kind: "signup", id: "" };
  const itemMatch = pathname.match(/^\/declutter\/item\/([^/]+)$/);
  if (itemMatch) return { kind: "declutter", id: decodeURIComponent(itemMatch[1]) };
  const bookMatch = pathname.match(/^\/book\/([^/]+)$/);
  if (bookMatch) return { kind: "book", id: decodeURIComponent(bookMatch[1]) };
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

  if (route.kind === "book") {
    const seg = safeIdSegment(route.id);
    return metaForBook(route.id, seg ? `${SITE_ORIGIN}/book/${seg}` : `${SITE_ORIGIN}/`);
  }

  if (route.kind === "declutter") {
    const seg = safeIdSegment(route.id);
    return metaForDeclutterItem(route.id, seg ? `${SITE_ORIGIN}/declutter/item/${seg}` : `${SITE_ORIGIN}/declutter`);
  }

  if (route.kind === "signup") {
    return metaForSignup(url.searchParams.get("ref"));
  }

  if (route.kind === "page") {
    return metaForPublicPage(route.id, url.searchParams.get("tab"));
  }

  if (route.kind === "noindex") {
    return metaForNoindexPage(route.id);
  }

  const seg = safeIdSegment(route.id);
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

function respond(html: string, cdnCache: string = "public, s-maxage=300, stale-while-revalidate=86400"): Response {
  return new Response(html, {
    status: 200,
    headers: {
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
      const meta = await resolveMeta(url);
      const shell = absolutiseIconLinks(SHELL_HTML);
      if (!meta) return respond(shell);
      // A shop card goes stale within minutes, never a day: a shop hidden,
      // paused or closed must stop previewing (lh-authz-rls should-fix 2).
      // A Declutter item card likewise: sold or withdrawn stops previewing (Q2426).
      return respond(withStaticBody(applyMeta(shell, meta), url), meta.cdnCache);
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
      return respond(absolutiseIconLinks(SHELL_HTML));
    }
  },
};
