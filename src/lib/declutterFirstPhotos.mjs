/**
 * /declutter's first-row card photos asked for IN THE RESPONSE HEADERS (Q2705, lead 11-08: guest /declutter LCP 6.4 s
 * live, the first card photo; owner rule: pages under 2 s).
 *
 * WHY. index.html's guest /declutter script (src/boot/guestDeclutterEarly.test.ts) can only start the first photos once
 * it knows their paths, and in the browser that takes the preview read (one slow round trip after the HTML, ~1.5 s on
 * Slow 4G), by which time the app's JavaScript shares the link. api/share.ts already serves /declutter (vercel.json
 * rewrite), so it reads the same anon preview (declutter_guest_preview, 20261107212823, SECURITY INVOKER: the anon
 * policies decide) and answers with a `Link: <...>; rel=preload; as=image` header for the first row's photos, with the
 * card's own srcset and sizes. The browser starts them with the HTML; the script's and the card's <img> reuse them.
 *
 * WHY A HEADER, NOT THE MARKUP. The pages api/share.ts serves keep storage paths out of the HTML (a path starts with
 * the poster's user id, and a preview of the HTML is cached by link crawlers: declutterShareCard, sharedLinksOwnPhoto,
 * the /browse shell's "no photos, no ids in the markup"). A response header is not part of any preview; it names only
 * the photos this same visitor's first screen requests a moment later. A path that is not plainly a path is left out.
 * Only phones get it (media): the desktop grid and its photos differ. The CDN cannot tell a member from a guest (the
 * session lives in the browser), so a member's phone fetches these two photos too, at the browser's normal priority
 * (no fetchpriority): its own first cards are usually the same newest items.
 *
 * Plain dependency-free ESM, like browseShellCards.mjs: the serverless function imports it with no TypeScript step.
 * Types: declutterFirstPhotos.d.mts.
 */

/** The shell's photo slots (index.html #lh-declutter-shell draws four cards). */
export const DECLUTTER_FIRST_PHOTO_COUNT = 4;

/** The anon preview read as a GET (the function is STABLE, so PostgREST serves it on GET). */
export function declutterGuestPreviewUrl(supabaseUrl) {
  return `${String(supabaseUrl).replace(/\/$/, "")}/rest/v1/rpc/declutter_guest_preview`;
}

const PATH_RE = /^[A-Za-z0-9_./-]+$/;

/** A storage path the tag may carry: path characters only, with a folder, no parent step. */
export function usablePhotoPath(path) {
  return typeof path === "string" && path.indexOf("/") > 0 && !path.includes("..") && PATH_RE.test(path);
}

/**
 * The first DECLUTTER_FIRST_PHOTO_COUNT items' first photo path, by slot ("-" for an item with none or an unusable
 * one), as the card picks it (photos by position, the first per item). Null for anything not shaped like the
 * preview's answer, or with no item at all.
 */
export function firstPhotoPaths(preview) {
  const p = preview;
  if (!p || typeof p !== "object" || !Array.isArray(p.items) || !Array.isArray(p.photos) || p.items.length === 0) return null;
  const first = new Map();
  for (const ph of p.photos) {
    if (ph && typeof ph.item_id === "string" && typeof ph.storage_path === "string" && !first.has(ph.item_id)) first.set(ph.item_id, ph.storage_path);
  }
  return p.items.slice(0, DECLUTTER_FIRST_PHOTO_COUNT).map((it) => {
    const path = it && typeof it.id === "string" ? first.get(it.id) : undefined;
    return usablePhotoPath(path) ? path : "-";
  });
}

/** COPY of src/boot/declutterPrefetch.ts's card photo URL rule (bucket, sizes, quality); the test pins them equal. */
const BUCKET = "job-photos";
const CARD_PX = 480;
const SMALL_PX = 340;
export const CARD_SIZES = "(min-width: 640px) 250px, calc(50vw - 26px)";
/** The first row at 375 (bootFirstRowCount below 640 px). */
export const FIRST_ROW = 2;

/** The card's src and srcset for this storage path. */
export function cardPhotoUrls(supabaseUrl, path) {
  const root = `${String(supabaseUrl).replace(/\/$/, "")}/storage/v1/render/image/public/${BUCKET}/`;
  const url = (px) => `${root}${path}?width=${px}&height=${px}&resize=cover&quality=55`;
  return { href: url(CARD_PX), srcset: `${url(SMALL_PX)} ${SMALL_PX}w, ${url(CARD_PX)} ${CARD_PX}w` };
}

/** The Link header value preloading the first row's photos on a phone; null with none. */
export function declutterPhotoPreloadHeader(supabaseUrl, paths) {
  if (!Array.isArray(paths)) return null;
  const links = paths
    .slice(0, FIRST_ROW)
    .filter(usablePhotoPath)
    .map((p) => {
      const { href, srcset } = cardPhotoUrls(supabaseUrl, p);
      return `<${href}>; rel=preload; as=image; imagesrcset="${srcset}"; imagesizes="${CARD_SIZES}"; media="(max-width: 899px)"`;
    });
  return links.length ? links.join(", ") : null;
}
