/**
 * The Declutter item page's photos (owner, 2026-10-19: photo-first, as on
 * Facebook Marketplace / OfferUp / Mercari): ONE full-width photo at a time,
 * swiped sideways (CSS scroll-snap, no library), dots for where you are, and
 * a tap opens the app's shared full-screen viewer (PhotoLightbox: pinch and
 * double-tap zoom, arrows, keyboard). No photos: the category icon on its
 * soft tint (PhotoPlaceholder), never a blank box.
 *
 * Owner 11-20 (item page polish #2, #3): on a computer (lg) a row of small thumbnails replaces the dots (a phone keeps
 * swipe + dots); a photo whose shape is not the frame's (a tall/portrait photo, shown whole) sits on a soft blurred,
 * darkened copy of itself instead of flat grey side bars. The whole photo still shows (object-contain from sm).
 */
import { lazy, Suspense, useRef, useState, type SyntheticEvent } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { FallbackImg } from "./FallbackImg";
import { ITEM_PHOTO_ASPECT, ITEM_PHOTO_FRAME_BASE } from "./itemPhotoFrame";
import { PhotoArrowButton } from "@/components/ui/PhotoArrowButton";
import { PhotoDotButton } from "@/components/ui/PhotoDotButton";
import { PHOTO_THUMB_IMG, PhotoThumbButton } from "@/components/ui/PhotoThumbButton";
import { PHONE_PHOTO_MEDIA, PHONE_PHOTO_SIZES, pageThumbUrl } from "@/lib/declutter/pagePhoto";
import { safePhotoSrc } from "@/lib/declutter/safePhotoSrc";

// The full-screen viewer opens on a tap, so it loads then, not with every cold item page (2.9 KB gz on its critical
// path, 11-11). Closed, it rendered nothing, so mounting it only while open changes nothing on screen.
const PhotoLightbox = lazy(() => import("@/components/dashboard/PhotoLightbox").then((m) => ({ default: m.PhotoLightbox })));

const FRAME_BASE = ITEM_PHOTO_FRAME_BASE;
const ASPECT = ITEM_PHOTO_ASPECT;
/** The item frame's shape from sm (4:3). A photo more than ~3% off it would show bars, so it gets the blurred backdrop. */
const FRAME_RATIO = 4 / 3;

/** The loaded photo's own file (its currentSrc, already in the cache) as a CSS url(), or null when it is not ours. */
function backdropUrl(img: HTMLImageElement): string | null {
  const safe = safePhotoSrc(img.currentSrc || img.src);
  return safe ? `url("${safe.replace(/["\\\n]/g, encodeURIComponent)}")` : null;
}

/** `icon`: the placeholder glyph when there is no photo (the job page passes the job category's; default: the Declutter category's). */
/** `display`: what the frame shows for each of `urls` (a resized photo and its srcSet, B67); `urls` stay the originals,
 * for the full-screen viewer and as the fallback when a resized photo fails. */
export function DeclutterGallery({ urls, display, category, title, icon, shape = "item" }: { urls: string[]; display?: ({ src: string; srcSet: string; phoneSrcSet?: string } | null)[]; category: string; title: string; icon?: LucideIcon; shape?: keyof typeof ASPECT }) {
  // A banner (the job page) always wears the one warm tint; items keep a tint per category.
  const FRAME = `${FRAME_BASE} ${ASPECT[shape]}`;
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  // Owner 11-20 #3: per photo, the blurred backdrop behind a photo that does not fill the 4:3 frame (null: fills it).
  const [backdrops, setBackdrops] = useState<Record<string, string | null>>({});
  const item = shape === "item";
  if (urls.length === 0) {
    return (
      <div className={FRAME} data-gallery-empty="">
        <PhotoPlaceholder icon={icon ?? categoryIcon(category)} seed={category} warm={shape === "banner"} className="h-full w-full" />
      </div>
    );
  }
  const go = (i: number) => {
    const el = track.current;
    const next = Math.max(0, Math.min(urls.length - 1, i));
    el?.scrollTo?.({ left: next * el.clientWidth, behavior: "smooth" });
    setAt(next);
  };
  const measure = (url: string) => (e: SyntheticEvent<HTMLImageElement>) => {
    if (!item) return;
    const img = e.currentTarget;
    const { naturalWidth: w, naturalHeight: h } = img;
    const off = w > 0 && h > 0 && Math.abs(w / h - FRAME_RATIO) / FRAME_RATIO > 0.03;
    const bg = off ? backdropUrl(img) : null;
    setBackdrops((b) => (b[url] === bg ? b : { ...b, [url]: bg }));
  };
  return (
    <div className="space-y-2">
      <div className={`${FRAME} group`}>
        <div
          ref={track}
          role="group"
          aria-roledescription="carousel"
          aria-label={`Photos of ${title}`}
          data-gallery-track=""
          className="flex h-full w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.clientWidth > 0) setAt(Math.round(el.scrollLeft / el.clientWidth));
          }}
        >
          {urls.map((url, i) => (
            <button
              key={url}
              type="button"
              className="relative h-full w-full shrink-0 snap-center overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-label={`Open photo ${i + 1} of ${urls.length} full screen`}
              onClick={() => setOpen(i)}
              data-photo-backdrop={backdrops[url] ? "" : undefined}
            >
              {/* Owner 11-20 #3: the photo's own blurred, darkened copy fills the sides (from sm, where the photo is shown
                  whole; a phone's square frame is filled by its square crop). The same file as the photo: no extra fetch. */}
              {backdrops[url] && (
                <span
                  aria-hidden
                  data-gallery-backdrop=""
                  className="pointer-events-none absolute inset-0 hidden scale-110 bg-cover bg-center blur-2xl brightness-[0.65] sm:block"
                  style={{ backgroundImage: backdrops[url]! }}
                />
              )}
              <FallbackImg
                src={display?.[i]?.src ?? url}
                srcSet={display?.[i]?.srcSet}
                // The frame is the page column, at most the 680px app-shell frame. Owner 11-14: on a phone the item photo is
                // full-bleed now (40px wider); the sizes stay as the entry's preload copy (boot/declutterItemPrefetch.ts) says,
                // so the preload still answers the photo's request and no larger file is fetched.
                sizes={display?.[i] ? "(min-width: 640px) 680px, calc(100vw - 40px)" : undefined}
                // Item page speed (11-09): a phone's square frame gets the square crop (pagePhoto.ts).
                phone={display?.[i]?.phoneSrcSet ? { media: PHONE_PHOTO_MEDIA, srcSet: display[i]!.phoneSrcSet!, sizes: PHONE_PHOTO_SIZES } : undefined}
                retrySrc={display?.[i] ? url : undefined}
                alt={`Photo ${i + 1} of ${urls.length}`}
                loading={i === 0 ? "eager" : "lazy"}
                onLoad={measure(url)}
                // L015 (landing audit 11-09): from sm the frame is 4:3 and capped in height, so a portrait photo lost its
                // top and bottom (the product name on the box). From sm the whole photo shows on the frame's ground; the
                // phone's square frame keeps the square crop it is served. Owner 11-20 #3: from sm the photo's own grey ground
                // is cleared (the frame behind it is the same grey), so a blurred backdrop shows at its sides.
                className="relative h-full w-full object-cover sm:object-contain sm:bg-transparent"
                fallback={<span aria-hidden className="block h-full w-full bg-photo-empty" />}
              />
            </button>
          ))}
        </div>
        {urls.length > 1 && (
          <>
            <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white" aria-live="polite">
              <span className="sr-only">Photo </span>{at + 1}/{urls.length}
            </span>
            {/* Arrows for a mouse (no swipe on a desktop); a phone swipes. */}
            <PhotoArrowButton
              aria-label="Previous photo"
              disabled={at === 0}
              onClick={() => go(at - 1)}
              className="left-3"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </PhotoArrowButton>
            <PhotoArrowButton
              aria-label="Next photo"
              disabled={at === urls.length - 1}
              onClick={() => go(at + 1)}
              className="right-3"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </PhotoArrowButton>
          </>
        )}
      </div>
      {urls.length > 1 && (
        // Dots show where you are (swipe or the arrows move); the counter on the photo says it in words.
        // F060 (UI audit 11-09): the 6px dots were the only way back to photo 1 with a mouse. Each dot is now a
        // 32px-tall button that shows its photo; the visible dot is a little larger (10px).
        // Owner 11-20 #2: on a computer the thumbnails below replace the dots (an item; the job banner keeps its dots).
        <div className={`flex justify-center ${item ? "lg:hidden" : ""}`} data-gallery-dots="">
          {urls.map((url, i) => (
            <PhotoDotButton key={url} current={i === at} aria-label={`Show photo ${i + 1} of ${urls.length}`} onClick={() => go(i)} />
          ))}
        </div>
      )}
      {item && urls.length > 1 && (
        // Owner 11-20 #2: a row of small thumbnails under the photo, from lg only. Hidden below lg, and a hidden lazy
        // image is never fetched, so a phone loads none of them; each is a ~160px square crop (pageThumbUrl).
        <div className="hidden flex-wrap gap-2 lg:flex" data-gallery-thumbs="">
          {urls.map((url, i) => (
            <PhotoThumbButton key={url} current={i === at} aria-label={`Show photo ${i + 1} of ${urls.length}`} onClick={() => go(i)}>
              <FallbackImg
                src={pageThumbUrl(url) ?? display?.[i]?.src ?? url}
                retrySrc={display?.[i]?.src ?? url}
                alt=""
                loading="lazy"
                decoding="async"
                className={PHOTO_THUMB_IMG}
                fallback={<span aria-hidden className="block h-full w-full bg-photo-empty" />}
              />
            </PhotoThumbButton>
          ))}
        </div>
      )}
      {open !== null && (
        <Suspense fallback={null}>
          <PhotoLightbox photos={urls} lightboxIndex={open} setLightboxIndex={setOpen} />
        </Suspense>
      )}
    </div>
  );
}
