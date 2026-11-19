/**
 * Branded short links (owner 11-18: "Yes, build go links. All of our links should be this way."):
 * https://www.louisianahelpr.com/go/<slug> answers a 302 to one affiliate link from the committed map
 * (src/content/goLinks.json, mirrored to src/content/goLinks.mjs for the server), so a shared link shows our
 * domain instead of go.shopmy.us, mavely.app.link or awin1.com. Read by api/go.ts and scripts/go-links.mjs.
 *
 * AMAZON NEVER GOES THROUGH /go/. The Amazon Associates Operating Agreement does not allow an Associate link
 * to be cloaked behind a redirect on your own domain, so amazon.com / amzn.to / any Amazon host is refused here,
 * by the add script and by src/test/goLinks.test.ts, whatever the map says.
 *
 * The target comes ONLY from the map, never from the request (no open redirect), and only on an allowlisted
 * host: the gift guides' affiliate link hosts (AFFILIATE_HOSTS in src/content/giftGuides.ts, exact two-way,
 * guarded) plus walmrt.us (the Walmart Creator short link).
 */

/** The hosts a /go/ link may send a visitor to. Equal to giftGuides.ts AFFILIATE_HOSTS plus walmrt.us (guarded). */
export const GO_LINK_HOSTS = Object.freeze([
  "mavely.app.link",
  "walmrt.us",
  "www.anrdoezrs.net",
  "www.kqzyfj.com",
  "www.jdoqocy.com",
  "www.dpbolvw.net",
  "www.tkqlhce.com",
  "www.awin1.com",
  "click.linksynergy.com",
  "go.shopmy.us",
  // Sam's Club Creator membership links (gift guides, owner 11-19).
  "samsclub.co",
]);

/** Where an unknown slug or a refused target goes. */
export const GO_FALLBACK_URL = "https://www.louisianahelpr.com/gift-guides";

/** A slug: lowercase letters, digits and single hyphens, 1-64 characters, no leading or trailing hyphen. */
export const GO_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const GO_SLUG_MAX = 64;

/** Any Amazon host (amazon.com and its country sites, amzn.to, amzn.com, a.co). */
export const AMAZON_HOST_RE = /(^|\.)(amazon\.[a-z.]+|amzn\.(to|com|eu|asia)|a\.co)$/i;

export const isGoSlug = (slug) => typeof slug === "string" && slug.length <= GO_SLUG_MAX && GO_SLUG_RE.test(slug);

/** True when `url` is an https link on an allowlisted host and never Amazon. */
export function isAllowedGoTarget(url) {
  if (typeof url !== "string") return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    // Not a URL at all: refused, and the caller falls back to the gift guides.
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const host = u.hostname.toLowerCase();
  if (AMAZON_HOST_RE.test(host)) return false;
  return GO_LINK_HOSTS.includes(host);
}

/**
 * The redirect target for `slug` from `map` ({slug: {url, label}}): the mapped url when the slug is well formed,
 * present as the map's OWN key and on an allowed host; otherwise GO_FALLBACK_URL.
 */
export function goTargetFor(slug, map) {
  if (!isGoSlug(slug) || !map || !Object.prototype.hasOwnProperty.call(map, slug)) return GO_FALLBACK_URL;
  const url = map[slug]?.url;
  return isAllowedGoTarget(url) ? url : GO_FALLBACK_URL;
}

/** A slug from free text: lowercase, accents dropped, runs of anything else to one hyphen, cut at a word. */
export function slugify(text, max = 48) {
  const s = String(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const at = cut.lastIndexOf("-");
  return (at > 8 ? cut.slice(0, at) : cut).replace(/-+$/g, "");
}
