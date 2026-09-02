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
  /** name="description" — also reused for og/twitter description. */
  description: string;
  /** Card headline. */
  ogTitle: string;
  /** Absolute canonical URL for this route. */
  url: string;
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
  out = setMetaContent(out, "property", "og:description", meta.description);
  out = setMetaContent(out, "name", "twitter:url", meta.url);
  out = setMetaContent(out, "name", "twitter:title", meta.ogTitle);
  out = setMetaContent(out, "name", "twitter:description", meta.description);
  return out;
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
}

/**
 * `open_jobs_browse` is the RLS-public masked view `src/pages/JobDetail.tsx`
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
  const columns = "id,title,category,budget,location,date_needed,pricing_mode,expires_at";
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
 * (Note for whoever owns src/pages/JobDetail.tsx: `usePageMeta` there does put
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
  if (!invited) {
    return {
      title: "Create your free Helpr account",
      ogTitle: "Join Helpr — Louisiana's local job marketplace",
      description:
        "Post a job or get paid to help your neighbors with cleaning, yard work, moving and errands. Payment is held safely until the work is confirmed done.",
      url: `${SITE_ORIGIN}/signup`,
    };
  }
  return {
    title: "You've been invited to Helpr",
    ogTitle: "You've been invited to join Helpr",
    description:
      "A neighbor invited you to Helpr — Louisiana's local job marketplace for cleaning, yard work, moving and errands. Sign up free with their invite.",
    url: `${SITE_ORIGIN}/signup`,
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
function resolveRoute(url: URL): { kind: "job" | "signup" | "user"; id: string } | null {
  const declared = url.searchParams.get("_og");
  if (declared === "job" || declared === "user") {
    return { kind: declared, id: url.searchParams.get("_id") ?? "" };
  }
  if (declared === "signup") return { kind: "signup", id: "" };

  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const jobMatch = pathname.match(/^\/jobs\/([^/]+)$/);
  if (jobMatch) return { kind: "job", id: decodeURIComponent(jobMatch[1]) };
  if (pathname === "/signup") return { kind: "signup", id: "" };
  const userMatch = pathname.match(/^\/user\/([^/]+)$/);
  if (userMatch) return { kind: "user", id: decodeURIComponent(userMatch[1]) };
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

  if (route.kind === "signup") {
    return metaForSignup(url.searchParams.get("ref"));
  }

  const seg = safeIdSegment(route.id);
  return metaForUser(seg ? `${SITE_ORIGIN}/user/${seg}` : `${SITE_ORIGIN}/login`);
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */

function respond(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // Browser caching is left to the site-wide `Cache-Control` rule in
      // vercel.json so this response behaves exactly like the static shell.
      // `Vercel-CDN-Cache-Control` is CDN-only and is not set by that rule, so
      // it adds edge caching without colliding with it — crawlers re-scraping
      // a popular job don't each cost a database round trip.
      "Vercel-CDN-Cache-Control": "public, s-maxage=300, stale-while-revalidate=86400",
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
      if (!meta) return respond(SHELL_HTML);
      return respond(applyMeta(SHELL_HTML, meta));
    } catch {
      return respond(SHELL_HTML);
    }
  },
};
