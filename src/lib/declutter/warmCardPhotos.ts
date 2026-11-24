/**
 * WARM A NEW LISTING'S CARD PHOTOS (declutter-speed-1124, owner rule "every page under 2 s"). Supabase's image transform
 * (storage/v1/render/image/public) makes each size the first time anyone asks for it and the CDN keeps it after that.
 * Measured 11-23 with curl from Louisiana (Cloudflare DFW, Accept: image/webp): a size nobody had asked for took
 * 0.49-0.83 s; the same URL right after, 0.13-0.15 s (cf-cache-status MISS then HIT). With about 50 /declutter visits a
 * week, the first buyer to see a new listing was the one paying that wait.
 *
 * So when a listing goes up, the seller's own device asks for the exact card URLs once, in the background: the Browse
 * card's 340 and 480 squares (cardPhotoSrcSet / photoCardUrl, the same bytes the cards, the shell and the document's
 * Link preloads ask for) and the landing card's 640x800 (photoLandingCardUrl). The seller is in Louisiana, so the CDN
 * point it fills is the one Louisiana buyers use. Loaded as images (never fetch()): a browser's image request says it
 * takes WebP, and the CDN keeps WebP and JPEG apart (vary: Accept, measured the same day), so a fetch() with its "any type" Accept
 * would fill the JPEG copy no browser reads.
 *
 * Nothing waits for it and nothing is shown: a photo that fails to warm is made on the first visit, as before.
 * Guard: src/test/declutterWarmCardPhotos1124.test.ts.
 */

/** Every URL a new listing's first photo is drawn at on /declutter and the landing page (one per place, no repeats). */
export function cardPhotoWarmUrls(urls: ReadonlyArray<string | null | undefined>): string[] {
  return [...new Set(urls.filter((u): u is string => typeof u === "string" && u.startsWith("http")))];
}

/** How a URL is asked for: an off-screen image, so the browser sends its own image Accept header. */
export type PhotoLoader = (url: string) => void;

const loadAsImage: PhotoLoader = (url) => {
  if (typeof Image === "undefined") return;
  const img = new Image();
  img.decoding = "async";
  img.src = url;
};

/** Ask for each URL once, in the background. Returns how many were asked for. */
export function warmCardPhotos(urls: ReadonlyArray<string | null | undefined>, load: PhotoLoader = loadAsImage): number {
  const list = cardPhotoWarmUrls(urls);
  for (const u of list) load(u);
  return list.length;
}
