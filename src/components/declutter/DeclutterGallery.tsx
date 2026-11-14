/**
 * The Declutter item page's photos (owner, 2026-10-19: photo-first, as on
 * Facebook Marketplace / OfferUp / Mercari): ONE full-width photo at a time,
 * swiped sideways (CSS scroll-snap, no library), dots for where you are, and
 * a tap opens the app's shared full-screen viewer (PhotoLightbox: pinch and
 * double-tap zoom, arrows, keyboard). No photos: the category icon on its
 * soft tint (PhotoPlaceholder), never a blank box.
 */
import { lazy, Suspense, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";
import { FallbackImg } from "./FallbackImg";
import { ITEM_PHOTO_ASPECT, ITEM_PHOTO_FRAME_BASE } from "./itemPhotoFrame";
import { PhotoArrowButton } from "@/components/ui/PhotoArrowButton";
import { PhotoDotButton } from "@/components/ui/PhotoDotButton";
import { PHONE_PHOTO_MEDIA, PHONE_PHOTO_SIZES } from "@/lib/declutter/pagePhoto";

// The full-screen viewer opens on a tap, so it loads then, not with every cold item page (2.9 KB gz on its critical
// path, 11-11). Closed, it rendered nothing, so mounting it only while open changes nothing on screen.
const PhotoLightbox = lazy(() => import("@/components/dashboard/PhotoLightbox").then((m) => ({ default: m.PhotoLightbox })));

const FRAME_BASE = ITEM_PHOTO_FRAME_BASE;
const ASPECT = ITEM_PHOTO_ASPECT;

/** `icon`: the placeholder glyph when there is no photo (the job page passes the job category's; default: the Declutter category's). */
/** `display`: what the frame shows for each of `urls` (a resized photo and its srcSet, B67); `urls` stay the originals,
 * for the full-screen viewer and as the fallback when a resized photo fails. */
export function DeclutterGallery({ urls, display, category, title, icon, shape = "item" }: { urls: string[]; display?: ({ src: string; srcSet: string; phoneSrcSet?: string } | null)[]; category: string; title: string; icon?: LucideIcon; shape?: keyof typeof ASPECT }) {
  // A banner (the job page) always wears the one warm tint; items keep a tint per category.
  const FRAME = `${FRAME_BASE} ${ASPECT[shape]}`;
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
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
              className="relative h-full w-full shrink-0 snap-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              aria-label={`Open photo ${i + 1} of ${urls.length} full screen`}
              onClick={() => setOpen(i)}
            >
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
                // L015 (landing audit 11-09): from sm the frame is 4:3 and capped in height, so a portrait photo lost its
                // top and bottom (the product name on the box). From sm the whole photo shows on the frame's ground; the
                // phone's square frame keeps the square crop it is served.
                className="h-full w-full object-cover sm:object-contain"
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
        <div className="flex justify-center" data-gallery-dots="">
          {urls.map((url, i) => (
            <PhotoDotButton key={url} current={i === at} aria-label={`Show photo ${i + 1} of ${urls.length}`} onClick={() => go(i)} />
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
