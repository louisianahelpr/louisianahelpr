import { AMAZON_TAG, SEARCH_FILLER, type CatalogPick } from "@/content/giftGuideCatalog";

/**
 * "Add from any store" for the gift lists (owner 2026-11-21: "people can put in the wish list ... we see the list,
 * create the links if we don't have it, and send - they buy with our link"; "someone can just type in ideas ... and we
 * find a link or closest match"). Everything here runs on the device and opens nothing: a pasted link is only read as
 * text (never fetched, never followed, so an affiliate short link is never opened).
 *   - pastedLink: a pasted https:// link to a public shop, or null (http, a bare IP, localhost, a non-web scheme, or a
 *     link with a user name in it are refused).
 *   - ourLink: the link a gift is bought through. An Amazon product link becomes amazon.com/dp/<ASIN> with OUR tag
 *     (louisianahelpr-20; any other tag is dropped); a link to a product our guides carry becomes the guide's own pick
 *     (its link, photo and price); anything else stays the shopper's own link, marked as not ours yet.
 *   - nameFromLink: a starting name for a pasted product, from the link's own words ("Cozy-Throw-Blanket" ->
 *     "Cozy Throw Blanket"); the shopper can change it before adding.
 *   - closestPicks: up to 3 of our guide picks whose name, brand or gift type share the typed words.
 * Guard: src/test/wishAnyLink1121.test.tsx.
 */

const AMAZON_HOST = /^(?:www\.|smile\.)?amazon\.com$/;
const ASIN_PATH = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?#]|$)/;
/** Hosts that only redirect somewhere else (a short or affiliate link): kept as typed, never converted or opened. */
const SHORT_HOSTS = new Set(["amzn.to", "a.co", "bit.ly", "tinyurl.com", "t.co", "goo.gl", "walmrt.us", "shopmy.us", "rstyle.me", "howl.me", "liketk.it"]);

/** A pasted link, cleaned, or null when it is not an https link to a public site. */
export function pastedLink(text: string): URL | null {
  const t = text.trim();
  if (!/^https:\/\//i.test(t) || t.length > 2000) return null;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    // Not a link at all: the caller treats the words as a typed idea.
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  if (!host.includes(".") || host === "localhost" || /^[\d.]+$/.test(host) || host.startsWith("[") || /\.(local|internal|test)$/.test(host)) return null;
  return u;
}

/** The ASIN of an Amazon product link in any of Amazon's own forms, or null. */
function asinOf(u: URL): string | null {
  if (!AMAZON_HOST.test(u.hostname.toLowerCase())) return null;
  const m = ASIN_PATH.exec(u.pathname);
  return m ? m[1] : null;
}

/** Host + path, lower case, no trailing slash: two links to the same product page compare equal. */
const pageKey = (u: URL) => `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
const keyOf = (href: string) => {
  try {
    return pageKey(new URL(href));
  } catch {
    // A pick link that does not parse matches nothing.
    return "";
  }
};

export type OurLink =
  | { kind: "pick"; pick: CatalogPick & { guide?: string } }
  | { kind: "amazon"; href: string; asin: string }
  | { kind: "plain"; href: string; short: boolean };

/** The link a pasted product is bought through (see the file note). */
export function ourLink(u: URL, picks: (CatalogPick & { guide?: string })[]): OurLink {
  const asin = asinOf(u);
  if (asin) {
    const pick = picks.find((p) => {
      try {
        return asinOf(new URL(p.href)) === asin;
      } catch {
        // A pick link that does not parse is no match.
        return false;
      }
    });
    return pick ? { kind: "pick", pick } : { kind: "amazon", href: `https://www.amazon.com/dp/${asin}?tag=${AMAZON_TAG}`, asin };
  }
  const key = pageKey(u);
  const pick = key.includes("/") ? picks.find((p) => keyOf(p.href) === key) : undefined;
  if (pick) return { kind: "pick", pick };
  return { kind: "plain", href: keptHref(u), short: SHORT_HOSTS.has(u.hostname.toLowerCase().replace(/^www\./, "")) };
}

/** Ad-tracking parameters dropped from a kept link (they never pick the product). */
const TRACKING = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|ttclid|_ga)$/i;
/** Longest link kept as pasted; a longer one keeps only its page (the planner row is capped at 64 KB). */
const KEPT_HREF_MAX = 500;

/** The link a pasted product is kept as: tracking parameters and the #part dropped, only the page when still too long. */
function keptHref(u: URL): string {
  const c = new URL(u.toString());
  for (const k of [...c.searchParams.keys()]) if (TRACKING.test(k)) c.searchParams.delete(k);
  c.hash = "";
  const href = c.toString();
  return href.length <= KEPT_HREF_MAX ? href : `${c.origin}${c.pathname}`.slice(0, KEPT_HREF_MAX);
}

/** A starting name from the link's own words, or "A gift from <shop>". */
export function nameFromLink(u: URL): string {
  const shop = u.hostname.toLowerCase().replace(/^www\./, "");
  const words = u.pathname.split("/").map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      // A broken escape in the link: that part is skipped.
      return "";
    }
  }).filter((s) => /[a-z].*[-_ ].*[a-z]/i.test(s) && !/^(dp|ip|p|product|products|item|gp)$/i.test(s));
  const best = words.sort((a, b) => b.length - a.length)[0];
  if (!best) return `A gift from ${shop}`;
  const name = best.replace(/\.[a-z]{2,5}$/i, "").replace(/[-_+]+/g, " ").replace(/\s+/g, " ").trim();
  return (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 120);
}

/** Up to `max` of our picks that share the most meaningful typed words (name, brand, gift type), best first. */
export function closestPicks<T extends CatalogPick>(text: string, picks: T[], max = 3): T[] {
  const words = [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !SEARCH_FILLER.has(w)))];
  if (words.length === 0) return [];
  const scored = picks.map((p) => {
    const hay = `${p.name} ${p.brand ?? ""} ${p.type ?? ""}`.toLowerCase();
    return { p, score: words.reduce((t, w) => t + (new RegExp(`\\b${w}`).test(hay) ? 1 : 0), 0) };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return scored.filter((x) => !seen.has(x.p.href) && !!seen.add(x.p.href)).slice(0, max).map((x) => x.p);
}
