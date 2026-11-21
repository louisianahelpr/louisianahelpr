/**
 * Branded short links (owner 11-18: "Yes, build go links. All of our links should be this way."):
 * vercel.json rewrites /go/:slug here as /api/go?slug=:slug, and this answers a 302 to that slug's affiliate
 * link from the committed map (src/content/goLinks.json, served from its mirror src/content/goLinks.mjs).
 *
 * - The target comes ONLY from the map. No other query parameter is read, so ?url=, ?to= or a forged slug can
 *   never send a visitor anywhere the map does not name (no open redirect).
 * - Only allowlisted affiliate hosts, never Amazon (src/lib/goLinks.mjs). An unknown slug or a refused target
 *   goes to the gift guides.
 * - Cache-Control private, no-store (holiday audit D L1: a cached 302 skipped the click log for 5 minutes, and a
 *   repointed slug is live at once); X-Robots-Tag noindex,
 *   nofollow (a redirect is no page to index, and affiliate links are never followed for ranking).
 * - Each hit inserts one analytics_events row (event go_link_click), the same anon insert path the signed-out
 *   app uses (src/lib/analytics.ts; policy anyone_can_insert_analytics, user_id null). It never blocks the
 *   redirect: it is handed to Vercel's waitUntil when the platform provides one, otherwise raced against a
 *   short timeout; every failure is swallowed.
 * Guard: src/test/goLinks.test.ts.
 */
import { GO_LINKS } from "../src/content/goLinks.mjs";
import { GO_FALLBACK_URL, goTargetFor, isGoSlug } from "../src/lib/goLinks.mjs";

export const GO_CACHE_CONTROL = "private, no-store";
export const GO_ROBOTS = "noindex, nofollow";
/** Budget for the click insert when it has to be awaited (no waitUntil). */
export const GO_LOG_TIMEOUT_MS = 300;

const SITE_ORIGIN = "https://www.louisianahelpr.com";
const SUPABASE_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "";

export function goRedirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location,
      "cache-control": GO_CACHE_CONTROL,
      "x-robots-tag": GO_ROBOTS,
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

/** The click row's insert; resolves (never rejects) whatever happens. */
export function logGoClick(slug: string, known: boolean, request: Request, timeoutMs = 1500): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return Promise.resolve();
  const ua = request.headers.get("user-agent");
  const referrer = request.headers.get("referer");
  // Where the link was shared (?src=fb, pin, comment…): a short tag we add to links we post, since in-app browsers often drop the referrer.
  const srcRaw = new URL(request.url, SITE_ORIGIN).searchParams.get("src");
  const src = srcRaw && /^[a-z0-9-]{1,24}$/.test(srcRaw) ? srcRaw : null;
  const row = {
    event: "go_link_click",
    user_id: null,
    properties: { slug, known, src },
    url: `${SITE_ORIGIN}/go/${slug}`,
    referrer: referrer ? referrer.slice(0, 500) : null,
    platform: "web",
  };
  return fetch(`${SUPABASE_URL}/rest/v1/analytics_events?columns=event,user_id,properties,url,referrer,platform`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "content-type": "application/json",
      prefer: "return=minimal",
      // The robot-tagging trigger (tag_automated_analytics_event) reads the User-Agent: pass the visitor's on.
      ...(ua ? { "user-agent": ua.slice(0, 300) } : {}),
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(timeoutMs),
  }).then(
    () => undefined,
    // Logging is best effort: a slow or failed insert never touches the redirect.
    () => undefined,
  );
}

type WaitUntil = (p: Promise<unknown>) => void;
/** Vercel's per-request waitUntil (what @vercel/functions reads), or null off the platform. */
function platformWaitUntil(): WaitUntil | null {
  const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for("@vercel/request-context")] as
    | { get?: () => { waitUntil?: WaitUntil } | undefined }
    | undefined;
  const fn = ctx?.get?.()?.waitUntil;
  return typeof fn === "function" ? fn : null;
}

export async function handleGo(request: Request): Promise<Response> {
  let raw: string;
  try {
    raw = new URL(request.url).searchParams.get("slug") ?? "";
  } catch {
    // An unparsable request URL: no slug, so the gift guides.
    raw = "";
  }
  const slug = raw.toLowerCase();
  const target = goTargetFor(slug, GO_LINKS);
  if (isGoSlug(slug)) {
    const log = logGoClick(slug, target !== GO_FALLBACK_URL, request);
    const waitUntil = platformWaitUntil();
    if (waitUntil) waitUntil(log);
    else await Promise.race([log, new Promise((r) => setTimeout(r, GO_LOG_TIMEOUT_MS))]);
  }
  return goRedirect(target);
}

export default {
  async fetch(request: Request): Promise<Response> {
    return handleGo(request);
  },
};
