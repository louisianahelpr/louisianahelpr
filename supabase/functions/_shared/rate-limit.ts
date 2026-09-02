// Rate limiting for the eighteen user-facing edge functions that import it.
//
// (EIGHTEEN, counted rather than repeated. The figure carried around this
// project is seventeen; `grep -l checkRateLimit supabase/functions/*/index.ts`
// returns admin-delete-user, admin-user-actions, ai-job-builder, cash-out-credits,
// claim-pif-credit, complete-signup, contact-support, create-bgc-payment,
// create-boost-payment, create-payment, create-pif-donation, delete-own-account,
// helpr-pass-wallet, instant-job-match, instant-payout, notify-email-change,
// pay-onboarding-fee and stripe-idv-start. `admin-user-actions` is the one the
// older count misses.)
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS USED TO BE, AND WHY IT LIMITED NOTHING
// ═══════════════════════════════════════════════════════════════════════════
//
// The previous implementation's doc comment read "Simple IP-based rate limiter
// using Supabase". It made no database call. It had two independent defects,
// either one of which on its own reduces it to decoration:
//
//   1. THE BUCKET KEY WAS SUPPLIED BY THE CALLER.
//      `req.headers.get("x-forwarded-for")?.split(",")[0]` reads the FIRST
//      element of an append-only header. Proxies APPEND their view of the peer,
//      so the first element is whatever the client put there and only the LAST
//      is written by the platform. `X-Forwarded-For: <anything>` therefore
//      bought a brand-new empty bucket on every request. Opting out of the
//      limit was a one-line curl flag.
//
//   2. THE STORE WAS A PER-ISOLATE `Map`.
//      `globalThis.__rateLimitStore` lives inside one edge isolate. Supabase
//      runs many at once and recycles them constantly, so counters were split
//      across isolates and wiped on every cold start. Even against a caller who
//      never touched the header, the real ceiling was "per isolate, until the
//      next cold start", which is not a ceiling.
//
// These sit in front of `create-payment`, `instant-payout`, `cash-out-credits`,
// `create-bgc-payment`, `pay-onboarding-fee`, `stripe-idv-start` and
// `ai-job-builder` — endpoints that spend money, Stripe quota or Gemini quota
// on every call.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT IT IS NOW
// ═══════════════════════════════════════════════════════════════════════════
//
// A durable, server-derived limiter backed by `public.rate_limit_hit`
// (migration 20260902035752) over a shared Postgres table, called here with the
// service-role key. Two rolling windows are graded in one round trip:
//
//   NARROW — the JWT subject when the request carries one, the server-derived
//            address when it does not. `maxRequests` per `windowMs`.
//   WIDE   — always the address. `ipMaxRequests` per `windowMs`, defaulting to
//            ten times the narrow limit.
//
// WHY THE SUBJECT IS TRUSTWORTHY AND A HEADER IS NOT. 33 of this project's 36
// configured functions run with `verify_jwt = true`, so the Supabase gateway
// has already validated the token's signature before the handler is entered —
// the `sub` claim is the platform's assertion, not the caller's. The decode
// below is therefore a read of an already-verified claim, not an act of trust.
//
// WHY THE WIDE WINDOW EXISTS ANYWAY. Three of the importers do run with
// `verify_jwt = false` (`create-payment`, `complete-signup`, `contact-support`),
// where a caller can present an unsigned token and rotate `sub` freely to
// escape its own narrow bucket. Rotating subjects lands in the wide one. It is
// deliberately an order of magnitude looser than the narrow window so that a
// shared NAT — or an address this module reads wrongly — cannot become a
// ceiling on ordinary use of a checkout endpoint.
//
// WHY IT FAILS OPEN. If the RPC cannot be reached, this module falls back to
// the in-memory limiter below and allows the request. Every endpoint that calls
// this does real database work immediately afterwards, so a database that
// cannot answer the rate-limit query cannot serve the request either: failing
// closed would turn a transient blip into a 429 storm across checkout and
// payouts while protecting nothing. The failure is logged loudly rather than
// swallowed, and the in-memory fallback means the degraded state is the old
// behaviour rather than no limit at all.

// The in-memory FALLBACK store. It is no longer the mechanism — it is what is
// left when the durable one is unreachable. Declaring it on `globalThis` is
// what makes reading and writing it legal under `noImplicitAny`.
declare global {
  // eslint-disable-next-line no-var
  var __rateLimitStore: Map<string, number[]> | undefined;
}

export interface RateLimitOptions {
  /** Rolling window width in milliseconds. */
  windowMs: number;
  /** Hits allowed per window for one subject (or one address, when anonymous). */
  maxRequests: number;
  /** Bucket name — one per endpoint, so budgets do not bleed across features. */
  keyPrefix: string;
  /**
   * Hits allowed per window for one address regardless of how many subjects it
   * presents. Defaults to `max(maxRequests * 10, 60)`: loose enough that an
   * office behind one NAT is never the reason checkout 429s, tight enough that
   * subject rotation is bounded instead of unbounded.
   */
  ipMaxRequests?: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  remaining: number;
  retryAfter?: number;
}

/** How long the RPC gets before we give up and fall back. */
const RPC_TIMEOUT_MS = 2000;

/**
 * The address the PLATFORM saw, not the one the caller claimed.
 *
 * `x-forwarded-for` is append-only: each proxy appends the peer it observed, so
 * the entry the platform itself added is the LAST one. Everything before it is
 * caller-supplied text. Taking `[0]` — as this module used to — hands the
 * bucket key to the caller; taking the last entry takes it back.
 *
 * `x-real-ip` and `cf-connecting-ip` are single-valued headers that a proxy
 * OVERWRITES rather than appends to, so they are usable fallbacks when no
 * forwarded-for is present at all.
 */
export function serverDerivedIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("cf-connecting-ip")?.trim() ||
    null;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The end user's id from the bearer token, or null.
 *
 * Reads the claim; does not verify the signature — see the header for why that
 * is the right division of labour (the gateway verifies for `verify_jwt = true`
 * functions, and the wide address window is what covers the three that are
 * not). Returns null for anything that is not an end-user token: the anon and
 * service-role keys carry a `role` but no `sub`, and the new `sb_secret_…`
 * keys are not JWTs at all, so all three fall through to address keying rather
 * than colliding in one shared subject bucket.
 */
export function jwtSubject(req: Request): string | null {
  const auth = req.headers.get("Authorization") ?? req.headers.get("authorization");
  if (!auth) return null;
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    // base64url → base64, re-padded. `atob` rejects the url-safe alphabet.
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { sub?: unknown; role?: unknown };
    const sub = typeof claims.sub === "string" ? claims.sub : null;
    if (!sub || !UUID_RE.test(sub)) return null;
    // `role` is present on every Supabase-issued token. Anything other than an
    // end-user role is a machine caller and must not occupy a user bucket.
    if (typeof claims.role === "string" && claims.role !== "authenticated") return null;
    return `u:${sub}`;
  } catch {
    // A malformed token is not an identity. Fall through to the address.
    return null;
  }
}

/** The degraded path: the old per-isolate limiter, kept as a backstop. */
function inMemoryFallback(
  key: string,
  windowMs: number,
  maxRequests: number,
): RateLimitVerdict {
  const now = Date.now();
  const windowStart = now - windowMs;
  if (!globalThis.__rateLimitStore) {
    globalThis.__rateLimitStore = new Map<string, number[]>();
  }
  const store = globalThis.__rateLimitStore;
  const timestamps = (store.get(key) || []).filter((t: number) => t > windowStart);

  if (timestamps.length >= maxRequests) {
    const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
  }
  timestamps.push(now);
  store.set(key, timestamps);
  return { allowed: true, remaining: maxRequests - timestamps.length };
}

/**
 * Grade one request against its bucket.
 *
 * Signature is unchanged from the version this replaces, so no call site had to
 * move. The behaviour underneath it is different in the only way that matters:
 * the key is now derived by the server and the counter now survives the isolate.
 */
export async function checkRateLimit(
  req: Request,
  options: RateLimitOptions,
): Promise<RateLimitVerdict> {
  const { windowMs, maxRequests, keyPrefix } = options;
  const ipMax = options.ipMaxRequests ?? Math.max(maxRequests * 10, 60);

  const subject = jwtSubject(req);
  const ip = serverDerivedIp(req);
  // The fallback key mirrors the durable one so a request graded in memory
  // during an outage lands in the same conceptual bucket it would have used.
  const fallbackKey = `${keyPrefix}:${subject ?? (ip ? `ip:${ip}` : "unknown")}`;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SECRET_KEY") ??
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) {
    console.error(
      `[rate-limit] no service credentials — ${keyPrefix} degraded to the in-memory limiter`,
    );
    return inMemoryFallback(fallbackKey, windowMs, maxRequests);
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/rate_limit_hit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        p_bucket: keyPrefix,
        p_subject: subject,
        p_ip: ip,
        p_window_seconds: Math.max(Math.ceil(windowMs / 1000), 1),
        p_max: maxRequests,
        p_ip_max: ipMax,
        // Recorded so `serverDerivedIp`'s last-hop choice stays auditable
        // against whatever Supabase's edge actually sends. See the column
        // comment in 20260902035752.
        p_forwarded_for: req.headers.get("x-forwarded-for"),
      }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });

    if (!res.ok) {
      // Read the body: PostgREST puts the reason in it, and "the rate limiter
      // is broken" is exactly the kind of thing that must not be a bare status
      // code in a log.
      const detail = await res.text().catch(() => "");
      console.error(
        `[rate-limit] rate_limit_hit ${res.status} for ${keyPrefix}: ${detail.slice(0, 300)}`,
      );
      return inMemoryFallback(fallbackKey, windowMs, maxRequests);
    }

    const verdict = await res.json() as {
      allowed?: boolean;
      remaining?: number;
      retry_after?: number;
      binding?: string;
    };

    if (typeof verdict?.allowed !== "boolean") {
      console.error(`[rate-limit] unreadable verdict for ${keyPrefix}`);
      return inMemoryFallback(fallbackKey, windowMs, maxRequests);
    }

    if (!verdict.allowed) {
      // Which window bound it is the difference between "one account is
      // hammering" and "one address is presenting many subjects", and those
      // want different responses from whoever reads this.
      console.warn(
        `[rate-limit] ${keyPrefix} blocked (${verdict.binding ?? "unknown"} window) ` +
          `subject=${subject ?? "none"} ip=${ip ?? "none"}`,
      );
    }

    return {
      allowed: verdict.allowed,
      remaining: verdict.remaining ?? 0,
      retryAfter: verdict.retry_after && verdict.retry_after > 0
        ? verdict.retry_after
        : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[rate-limit] rate_limit_hit unreachable for ${keyPrefix} (${message}) — degraded to the in-memory limiter`,
    );
    return inMemoryFallback(fallbackKey, windowMs, maxRequests);
  }
}

export function rateLimitResponse(retryAfter: number, corsHeaders: Record<string, string>) {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
      },
    },
  );
}
