/**
 * A pasted shop link's title, photo and price, for Admin -> Wish list links (gift lists lane, 2026-11-21: "the server
 * fetch of a pasted link's title, photo and price for the link queue"). Pure helpers plus one SSRF-safe page read, so
 * the rules are unit-tested (src/test/edge/wishLinkPages.test.ts) without the function's Supabase wiring.
 *
 * WHAT IS FETCHED, AND WHAT NEVER IS
 *   - Only a page on a shop in SHOP_HOSTS (a fixed list of big retailers whose product pages carry Open Graph or
 *     schema.org Product data). Any other host is never fetched ("skipped").
 *   - NEVER Amazon (amazon.*, amzn.*, a.co, nor an Amazon-owned shop such as Zappos): the Associates agreement forbids
 *     scraping its pages; Amazon links are
 *     already ours (wish_link_request_add saves them filled) and the admin opens them by hand.
 *   - Never a short or affiliate link (bit.ly, go.shopmy.us, ...): not on the list, so never fetched, and a redirect
 *     is followed only to another listed shop.
 *   - Every hop goes through the str-ical-sync SSRF gate (assertPublicUrl: https/http on 80/443 only, no credentials,
 *     EVERY resolved address public), with redirect: "manual" and at most MAX_REDIRECTS hops; the body is read up to
 *     MAX_PAGE_BYTES and no further; each hop and the whole read are time-boxed.
 *   - Nothing about a failure reaches the caller but its kind (ok / none / skipped / blocked / failed): the admin page
 *     shows counts only, so the function is no port or host oracle.
 *
 * WHAT IS READ FROM THE PAGE
 *   - title: og:title, then twitter:title, then <title>; tags stripped, entities decoded, control characters dropped,
 *     at most 200 characters.
 *   - photo: og:image (or og:image:secure_url / twitter:image), made absolute against the page, https only, 500 max.
 *   - price: a schema.org Product's offers.price with priceCurrency USD (JSON-LD), else product:price:amount /
 *     og:price:amount with a USD currency tag. Never a price in another currency, never one we cannot read as a
 *     positive amount under $100,000. No price is better than a wrong one.
 */
import { BlockedUrlError, assertPublicUrl, type DnsResolver } from "../str-ical-sync/safeFetch.ts";

/** The shops whose product pages we read (the host or any subdomain of it). Amazon is never on it. */
export const SHOP_HOSTS: readonly string[] = [
  "etsy.com", "target.com", "walmart.com", "bestbuy.com", "kohls.com", "macys.com", "nordstrom.com", "ulta.com",
  "sephora.com", "anthropologie.com", "urbanoutfitters.com", "freepeople.com", "lululemon.com", "gap.com", "jcrew.com",
  "llbean.com", "rei.com", "dickssportinggoods.com", "academy.com", "homedepot.com", "lowes.com", "wayfair.com",
  "potterybarn.com", "potterybarnkids.com", "williams-sonoma.com", "westelm.com", "crateandbarrel.com", "michaels.com",
  "hobbylobby.com", "barnesandnoble.com", "lego.com", "yeti.com", "stanley1913.com", "crocs.com", "ugg.com", "nike.com",
  "kendrascott.com", "baublebar.com", "southerntide.com", "vineyardvines.com", "oldnavy.com",
];

/** Amazon in any form: never fetched, even if someone adds it to the list by mistake. */
const AMAZON = /(^|\.)(amazon\.[a-z.]+|amzn\.[a-z]+|a\.co)$/i;

export const MAX_PAGE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 3;
const PER_HOP_MS = 6_000;
const TOTAL_MS = 12_000;

/** True when this host is a listed shop (or a subdomain of one) and not Amazon. */
export function isShopHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  if (AMAZON.test(h)) return false;
  return SHOP_HOSTS.some((s) => h === s || h.endsWith(`.${s}`));
}

export interface PageDetails { title: string | null; image: string | null; price: number | null }
export type PageOutcome = { status: "ok" | "none"; details: PageDetails } | { status: "skipped" | "blocked" | "failed" };

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Words safe to show: tags stripped, entities decoded, control/zero-width/direction characters dropped, 200 max. */
export function cleanTitle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = decode(raw.replace(/<[^>]*>/g, " "))
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t ? t.slice(0, 200) : null;
}

/** An https photo link, absolute against the page, 500 characters at most; else null. */
function cleanImage(raw: string | null | undefined, page: URL): string | null {
  if (!raw) return null;
  try {
    const u = new URL(decode(raw.trim()), page);
    if (u.protocol !== "https:" || u.username || u.password) return null;
    const s = u.toString();
    return s.length <= 500 ? s : null;
  } catch {
    // An unreadable photo link is no photo.
    return null;
  }
}

/** A positive dollar amount under $100,000, to the cent; else null. */
export function cleanPrice(raw: unknown): number | null {
  const s = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.replace(/[$,\s]/g, "") : "";
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100) / 100;
  return n > 0 && n < 100_000 ? n : null;
}

/** Every <meta> tag's property/name -> content (first one wins). */
function metaTags(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag);
    if (key && content && !out.has(key)) out.set(key, content[1] ?? content[2] ?? "");
  }
  return out;
}

/** The first schema.org Product's USD price in the page's JSON-LD, or null. */
function jsonLdPrice(html: string): number | null {
  let blocks = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    // At most 20 blocks (lh-authz-rls review: a page of unclosed script tags made this regex slow).
    if (++blocks > 20) break;
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      // A block that is not JSON says nothing; the next one may.
      continue;
    }
    const stack: unknown[] = [data];
    for (let seen = 0; stack.length > 0 && seen < 500; seen++) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!node || typeof node !== "object") continue;
      const o = node as Record<string, unknown>;
      const type = o["@type"];
      const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
      if (isProduct && o.offers) {
        const offers = Array.isArray(o.offers) ? o.offers : [o.offers];
        for (const off of offers) {
          if (!off || typeof off !== "object") continue;
          const of = off as Record<string, unknown>;
          if (String(of.priceCurrency ?? "").toUpperCase() !== "USD") continue;
          const p = cleanPrice(of.price ?? of.lowPrice);
          if (p !== null) return p;
        }
      }
      if (o["@graph"]) stack.push(o["@graph"]);
    }
  }
  return null;
}

/** The page's title, photo and price, read from its HTML (see the header). */
export function readPageDetails(html: string, page: URL): PageDetails {
  const meta = metaTags(html);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const title = cleanTitle(meta.get("og:title") ?? meta.get("twitter:title") ?? titleTag);
  const image = cleanImage(meta.get("og:image:secure_url") ?? meta.get("og:image") ?? meta.get("twitter:image"), page);
  let price = jsonLdPrice(html);
  if (price === null) {
    const cur = (meta.get("product:price:currency") ?? meta.get("og:price:currency") ?? "").toUpperCase();
    if (cur === "USD") price = cleanPrice(meta.get("product:price:amount") ?? meta.get("og:price:amount"));
  }
  return { title, image, price };
}

/** Read at most `limit` bytes of the body (never the whole of an endless one). */
async function readUpTo(resp: Response, limit: number): Promise<string> {
  const body = resp.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = value.byteLength > limit - total ? value.subarray(0, limit - total) : value;
      chunks.push(take);
      total += take.byteLength;
    }
  } finally {
    // Release the connection whether the page ended or we stopped reading.
    await reader.cancel().catch(() => undefined);
  }
  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(joined);
}

/**
 * Fetch one pasted link's page safely and read its details. Never throws: every outcome is one of the five kinds.
 * `resolve` and `fetchImpl` are seams for the unit tests.
 */
export async function fetchPageDetails(
  rawUrl: string,
  opts: { resolve?: DnsResolver; fetchImpl?: typeof fetch; now?: () => number } = {},
): Promise<PageOutcome> {
  const doFetch = opts.fetchImpl ?? fetch;
  const clock = opts.now ?? (() => Date.now());
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    // Silence is right here: a stored link that does not parse is simply never fetched, and "skipped" says so.
    return { status: "skipped" };
  }
  if (target.protocol !== "https:" || !isShopHost(target.hostname)) return { status: "skipped" };
  const deadline = clock() + TOTAL_MS;
  // The address check (DNS) runs inside the same time budget (lh-silent-failure review: a slow resolver had none).
  const checked = async (u: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        assertPublicUrl(u, opts.resolve),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("address check timed out")), Math.max(0, deadline - clock()));
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    target = await checked(target.toString());
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const left = deadline - clock();
      if (left <= 0) return { status: "failed" };
      const resp = await doFetch(target.toString(), {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; HelprLinkPreview/1.0)", Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
        signal: AbortSignal.timeout(Math.min(PER_HOP_MS, left)),
      });
      if (resp.status >= 300 && resp.status < 400) {
        const location = resp.headers.get("location");
        await resp.body?.cancel().catch(() => undefined);
        if (!location || hop === MAX_REDIRECTS) return { status: "failed" };
        const next = new URL(location, target);
        // A redirect is followed only to another listed shop, over https (never to a short or affiliate link).
        if (next.protocol !== "https:" || !isShopHost(next.hostname)) return { status: "skipped" };
        target = await checked(next.toString());
        continue;
      }
      if (!resp.ok || !/text\/html|application\/xhtml/i.test(resp.headers.get("content-type") ?? "")) {
        await resp.body?.cancel().catch(() => undefined);
        return { status: "failed" };
      }
      const details = readPageDetails(await readUpTo(resp, MAX_PAGE_BYTES), target);
      const any = details.title !== null || details.image !== null || details.price !== null;
      return { status: any ? "ok" : "none", details };
    }
    return { status: "failed" };
  } catch (e) {
    // The kind only: the reason stays in the function log (no host or port oracle).
    if (e instanceof BlockedUrlError) return { status: "blocked" };
    console.warn("wish-link-pages: page read failed", (e as Error)?.name ?? "error");
    return { status: "failed" };
  }
}
