/**
 * safeFetch — SSRF-hardened fetch for the ONE user-supplied URL this project
 * dereferences server-side: `str_calendar_connections.ical_url`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ical_url` is `text NOT NULL` with no CHECK constraint, and the RLS policy on
 * `str_calendar_connections` is `FOR ALL USING (auth.uid() = user_id)` — so any
 * signed-in user may store any string and then make an edge function fetch it,
 * either by tapping "Sync now" or by waiting for the six-hourly cron. Before
 * this module the fetch was `fetch(conn.ical_url)` with a 10s timeout and
 * nothing else: no scheme check, no address check, no redirect handling, no
 * size cap.
 *
 * Measured against PRODUCTION on 2026-09-01 from a signed-in non-admin account
 * (`role: customer`), by storing each URL and invoking the function:
 *
 *   http://127.0.0.1/                     → "Connection refused (os error 111)"
 *   http://[::1]/                         → "Connection refused (os error 111)"
 *   http://localtest.me/  (public DNS →   → "Connection refused (os error 111)"
 *                          127.0.0.1)
 *   http://100.100.100.200/               → "Signal timed out."   (10s)
 *   http://[fd00::1]/                     → "Signal timed out."   (10s)
 *   http://metadata.google.internal/      → "dns error: failed to lookup ..."
 *   http://169.254.169.254/latest/…       → "Invalid argument (os error 22)"
 *   https://httpbin.org/status/418        → "iCal fetch failed: 418"
 *
 * Two things that list proves, and which no code read would have settled:
 *
 *  1. The runtime does NOT protect us. Deno Deploy refuses 169.254.0.0/16 at
 *     the socket (os error 22), and that single accident is the only reason the
 *     cloud-metadata read failed. Loopback was NOT refused — it connected and
 *     got RST. So the platform blocks exactly one range and the application
 *     must block the rest.
 *
 *  2. The distinct outcomes — refused vs. timed-out vs. DNS-error vs. an HTTP
 *     status — are an ORACLE. Every one of those strings was written to
 *     `str_calendar_connections.last_sync_error`, which the same RLS policy
 *     lets the attacker read straight back. That is a working internal port and
 *     host scanner with a REST API in front of it, which is why this module is
 *     paired with error sanitisation in index.ts: closing the fetch without
 *     closing the readback would leave the scanner running.
 *
 * And the redirect bypass, proven on the same run — the reason a check that
 * only validates the URL the user typed is not a fix:
 *
 *   https://httpbin.org/redirect-to?url=http://127.0.0.1/
 *     → "error sending request for url (http://127.0.0.1/): Connection refused"
 *   https://httpbin.org/redirect-to?url=http://169.254.169.254/
 *     → "error sending request for url (http://169.254.169.254/): os error 22"
 *
 * The stored URL is a perfectly ordinary public HTTPS address. `fetch` followed
 * the 302 to loopback on its own, because its default `redirect: "follow"`
 * re-resolves and re-connects with no callback. Hence `redirect: "manual"`
 * below and a re-validation of EVERY hop.
 *
 * WHAT THIS IS NOT
 * ----------------
 * This is not a hostname blocklist. A blocklist of names ("localhost",
 * "metadata.google.internal") is defeated by any attacker-controlled DNS record
 * — `localtest.me` above is a public name that resolves to 127.0.0.1 and would
 * pass any name-based filter. The control here is on the RESOLVED ADDRESS, plus
 * a scheme allowlist and a port allowlist, applied to every redirect hop.
 *
 * RESIDUAL RISK, STATED PLAINLY
 * -----------------------------
 * There is a TOCTOU window: we resolve the hostname, check the addresses, then
 * hand the HOSTNAME to `fetch`, which resolves it a second time. A DNS record
 * with a ~0 TTL that answers "public" then "private" can slip between the two
 * (classic DNS rebinding). Closing it completely needs connect-by-IP with a
 * pinned Host header, which breaks TLS SNI/certificate validation for https —
 * a worse trade for a feed fetcher. What narrows it here: the port allowlist
 * (80/443 only) removes internal port scanning as a payload, the scheme
 * allowlist removes `file:`/`data:`/`gopher:`, and index.ts no longer echoes
 * the outcome back, so a winning rebind is BLIND. Documented rather than
 * silently accepted.
 */

/** Thrown for any URL we refuse to dereference. `reason` is safe to log. */
export class BlockedUrlError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "BlockedUrlError";
    this.reason = reason;
  }
}

/** Thrown when a feed is well-formed but too large / too slow to be worth it. */
export class FeedTooLargeError extends Error {
  constructor(limitBytes: number) {
    super(`feed exceeded ${limitBytes} bytes`);
    this.name = "FeedTooLargeError";
  }
}

// ---------------------------------------------------------------------------
// Limits. Deliberately small: a real Airbnb/VRBO iCal export for one property
// is a few KB, and the largest plausible multi-year feed is well under 1 MB.
// ---------------------------------------------------------------------------

/** Hard cap on the response body. `.text()` on an unbounded body is an OOM. */
export const MAX_FEED_BYTES = 2 * 1024 * 1024; // 2 MiB
/** Redirect hops we will follow. Airbnb/VRBO use at most one (webcal → https). */
export const MAX_REDIRECTS = 3;
/** Per-hop connect/response timeout. */
export const PER_HOP_TIMEOUT_MS = 8_000;
/** Wall-clock budget for the whole chain, so N hops can't multiply the timeout. */
export const TOTAL_TIMEOUT_MS = 15_000;

/** The only schemes we will dereference. `webcal:` is normalised to https. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
/** The only ports we will connect to. Kills internal port scanning outright. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

// ---------------------------------------------------------------------------
// Address classification
// ---------------------------------------------------------------------------

/**
 * IPv4 ranges that must never be dereferenced, as [firstOctetMatcher] predicates
 * over the four octets. Covers RFC1918, loopback, link-local (incl. the cloud
 * metadata address), CGNAT, benchmarking, documentation, 6to4 relay anycast,
 * multicast and the reserved 240/4 block.
 */
function isBlockedIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 0) return true;                                  // 0.0.0.0/8 "this network"
  if (a === 10) return true;                                 // 10/8      RFC1918
  if (a === 127) return true;                                // 127/8     loopback
  if (a === 169 && b === 254) return true;                   // 169.254/16 link-local + metadata
  if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16/12 RFC1918
  if (a === 192 && b === 168) return true;                   // 192.168/16 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true;         // 100.64/10 CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true;      // 198.18/15 benchmarking
  if (a === 192 && b === 0) return true;                     // 192.0.0/24 + 192.0.2/24 docs
  if (a === 192 && b === 88) return true;                    // 192.88.99/24 6to4 relay
  if (a === 198 && b === 51) return true;                    // 198.51.100/24 docs
  if (a === 203 && b === 0) return true;                     // 203.0.113/24 docs
  if (a >= 224) return true;                                 // 224/4 multicast + 240/4 reserved
  return false;
}

/** Parse a dotted-quad into octets, or null if it is not one. */
function parseIPv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets;
}

/**
 * Classify a literal IP address. Anything we cannot confidently call public is
 * treated as blocked — fail closed, per the audit standard.
 *
 * Note on IPv4-mapped / 6to4 / NAT64 forms: each embeds an IPv4 address inside
 * an IPv6 one, so `::ffff:127.0.0.1` and `2002:7f00:0001::` must be unwrapped
 * and re-checked against the IPv4 rules rather than treated as opaque v6.
 */
export function classifyIp(ip: string): "public" | "blocked" | "invalid" {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!addr) return "invalid";

  // --- IPv4 -----------------------------------------------------------------
  const v4 = parseIPv4(addr);
  if (v4) return isBlockedIPv4(v4) ? "blocked" : "public";

  // --- IPv6 -----------------------------------------------------------------
  if (!addr.includes(":")) return "invalid";

  // Strip any zone index (fe80::1%eth0) — a zone only exists on link-local.
  const bare = addr.split("%")[0];

  // Unspecified / loopback.
  if (bare === "::" || bare === "::1") return "blocked";

  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): unwrap.
  const mapped = bare.match(/^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) {
    const inner = parseIPv4(mapped[1]);
    if (!inner) return "invalid";
    return isBlockedIPv4(inner) ? "blocked" : "public";
  }

  // 6to4 (2002::/16) embeds the v4 address in the next 32 bits.
  if (bare.startsWith("2002:")) {
    const groups = bare.split(":");
    const hi = parseInt(groups[1] ?? "", 16);
    const lo = parseInt(groups[2] ?? "", 16);
    if (Number.isNaN(hi) || Number.isNaN(lo)) return "blocked";
    const inner = [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
    return isBlockedIPv4(inner) ? "blocked" : "public";
  }

  // NAT64 well-known prefix (64:ff9b::/96) also wraps a v4 address.
  if (bare.startsWith("64:ff9b:")) return "blocked";

  const head = parseInt(bare.split(":")[0] || "0", 16);
  if (Number.isNaN(head)) return "invalid";
  if ((head & 0xfe00) === 0xfc00) return "blocked";  // fc00::/7  unique-local
  if ((head & 0xffc0) === 0xfe80) return "blocked";  // fe80::/10 link-local
  if ((head & 0xff00) === 0xff00) return "blocked";  // ff00::/8  multicast
  if (head === 0x2001) {
    const second = parseInt(bare.split(":")[1] || "0", 16);
    if (second === 0x0db8) return "blocked";         // 2001:db8::/32 documentation
    if (second === 0x0000) return "blocked";         // 2001::/32 Teredo
  }
  if (bare.startsWith("100:")) return "blocked";     // 100::/64 discard-only

  return "public";
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/** DNS resolver seam — injected so the range logic is unit-testable. */
export type DnsResolver = (hostname: string) => Promise<string[]>;

/**
 * Resolve A + AAAA through Deno. Kept behind `globalThis` rather than the bare
 * `Deno` global so this module also imports cleanly under vitest/node, where
 * the tests supply their own resolver.
 */
export const denoResolver: DnsResolver = async (hostname: string) => {
  const D = (globalThis as {
    Deno?: { resolveDns?: (h: string, t: string) => Promise<string[]> };
  }).Deno;
  if (!D?.resolveDns) {
    // No resolver available in this runtime. Fail CLOSED: without the resolved
    // addresses the range check cannot run, and a fetch we cannot vet is
    // exactly the thing this module exists to prevent. Better a host whose
    // feed stops syncing than a re-opened SSRF.
    //
    // This is the ONE way this module can break working syncs, so it says so
    // loudly rather than hiding inside the generic "rejected" message a host
    // sees. If EVERY connection starts failing right after a deploy, this line
    // in the function log is the answer: the runtime does not expose
    // Deno.resolveDns and the address check has no way to run. The fix is a
    // runtime/permission change, NOT loosening the check.
    console.error(
      "str-ical-sync: Deno.resolveDns unavailable in this runtime — " +
      "every hostname feed will be refused until the address check can run. " +
      "This is fail-closed by design; do not bypass it.",
    );
    throw new BlockedUrlError("address could not be verified");
  }
  const out: string[] = [];
  const settled = await Promise.allSettled([
    D.resolveDns(hostname, "A"),
    D.resolveDns(hostname, "AAAA"),
  ]);
  for (const r of settled) if (r.status === "fulfilled") out.push(...r.value);
  return out;
};

/**
 * Structural checks that need no network: scheme, embedded credentials, port,
 * and — when the host is already a literal IP — the range check.
 *
 * `webcal://` is rewritten to `https://`. It is the scheme Airbnb and VRBO put
 * on their "copy calendar link" buttons, so refusing it outright would reject
 * the single most likely thing a host pastes in. It is not a network protocol;
 * it means "an iCal file over HTTP(S)".
 */
export function normalizeAndCheckShape(raw: string): URL {
  // The webcal→https rewrite MUST happen on the string, before parsing.
  // `webcal:` is a non-special scheme to the WHATWG URL parser, and the
  // `url.protocol` setter silently REFUSES to change a non-special scheme into
  // a special one — so `url.protocol = "https:"` is a no-op and the URL stays
  // webcal:, which then fails the allowlist below. (Caught by the unit test
  // for this exact case, not by reading it.) Parsing it as https from the
  // start also gives us correct host/port parsing, which a non-special scheme
  // does not guarantee.
  const trimmed = String(raw).trim();
  const rewritten = /^webcal:\/\//i.test(trimmed)
    ? `https://${trimmed.slice("webcal://".length)}`
    : trimmed;

  let url: URL;
  try {
    url = new URL(rewritten);
  } catch {
    throw new BlockedUrlError("not a valid URL");
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new BlockedUrlError("unsupported URL scheme");
  }
  // Credentials in the URL get forwarded to whatever we connect to, and are a
  // classic way to smuggle a different authority past a naive parser.
  if (url.username || url.password) {
    throw new BlockedUrlError("URL must not contain credentials");
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    throw new BlockedUrlError("unsupported port");
  }
  if (!url.hostname) {
    throw new BlockedUrlError("URL has no host");
  }

  // A literal IP never needs DNS — classify it now so the resolver is only
  // consulted for real names.
  const literal = classifyIp(url.hostname);
  if (literal === "blocked") {
    throw new BlockedUrlError("address is not publicly routable");
  }
  return url;
}

/**
 * Full check: shape, then every resolved address. Throws `BlockedUrlError` on
 * the first thing that fails.
 *
 * ALL resolved addresses must be public. Checking only the first is a known
 * bypass — a name with one public A record and one private one would pass on a
 * lucky ordering and connect to the private one on the retry.
 */
export async function assertPublicUrl(
  raw: string,
  resolve: DnsResolver = denoResolver,
): Promise<URL> {
  const url = normalizeAndCheckShape(raw);

  // Host was a literal IP and already cleared by normalizeAndCheckShape.
  if (classifyIp(url.hostname) === "public") return url;

  let addrs: string[];
  try {
    addrs = await resolve(url.hostname);
  } catch (err) {
    if (err instanceof BlockedUrlError) throw err;
    throw new BlockedUrlError("host could not be resolved");
  }
  if (addrs.length === 0) throw new BlockedUrlError("host could not be resolved");

  for (const a of addrs) {
    const verdict = classifyIp(a);
    if (verdict !== "public") {
      throw new BlockedUrlError("address is not publicly routable");
    }
  }
  return url;
}

// ---------------------------------------------------------------------------
// The fetch itself
// ---------------------------------------------------------------------------

/**
 * Read a response body with a hard byte ceiling, without ever materialising
 * more than the ceiling in memory.
 *
 * `Response.text()` cannot do this: it buffers whatever arrives, so a feed URL
 * pointed at an endless stream is an OOM that takes the isolate down. A
 * `Content-Length` check alone is not enough either — it is attacker-supplied
 * and absent on a chunked response.
 */
async function readCapped(resp: Response, limitBytes: number): Promise<string> {
  const declared = Number(resp.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limitBytes) {
    await resp.body?.cancel();
    throw new FeedTooLargeError(limitBytes);
  }

  const body = resp.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limitBytes) throw new FeedTooLargeError(limitBytes);
      chunks.push(value);
    }
  } finally {
    // Releases the connection whether we finished or bailed out early.
    try { await reader.cancel(); } catch { /* already closed */ }
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.byteLength; }
  return new TextDecoder("utf-8").decode(joined);
}

/**
 * Fetch an iCal feed from a user-supplied URL, safely.
 *
 * Every hop is re-validated, because the whole point of the redirect bypass is
 * that hop 1 is innocent. Redirects are handled manually (`redirect: "manual"`)
 * — with the default `"follow"` the runtime chases the Location header itself
 * and there is no seam to check it.
 */
export async function fetchIcalFeed(
  rawUrl: string,
  opts: {
    resolve?: DnsResolver;
    maxBytes?: number;
    maxRedirects?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
  } = {},
): Promise<string> {
  const resolve = opts.resolve ?? denoResolver;
  const maxBytes = opts.maxBytes ?? MAX_FEED_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const doFetch = opts.fetchImpl ?? fetch;
  const clock = opts.now ?? (() => Date.now());

  const deadline = clock() + TOTAL_TIMEOUT_MS;
  let target = await assertPublicUrl(rawUrl, resolve);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const remaining = deadline - clock();
    if (remaining <= 0) throw new BlockedUrlError("feed timed out");

    const resp = await doFetch(target.toString(), {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "Louisiana-Helpr/1.0 iCal-Sync",
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
      },
      signal: AbortSignal.timeout(Math.min(PER_HOP_TIMEOUT_MS, remaining)),
    });

    // 3xx — validate the next hop through the SAME gate before following it.
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get("location");
      await resp.body?.cancel();
      if (!location) throw new BlockedUrlError("redirect without a location");
      if (hop === maxRedirects) throw new BlockedUrlError("too many redirects");
      // Relative Locations are legal and common; resolve against the hop we
      // are currently on, then re-run the full check on the result.
      const next = new URL(location, target);
      target = await assertPublicUrl(next.toString(), resolve);
      continue;
    }

    if (!resp.ok) {
      await resp.body?.cancel();
      // Status is echoed to the operator log only, never to the connection
      // owner — see the sanitiser in index.ts.
      throw new Error(`iCal fetch failed: ${resp.status}`);
    }

    return await readCapped(resp, maxBytes);
  }

  throw new BlockedUrlError("too many redirects");
}
