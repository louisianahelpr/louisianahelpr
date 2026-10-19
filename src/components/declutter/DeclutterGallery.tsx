/**
 * The Declutter item page's photos (owner, 2026-10-19: photo-first, as on
 * Facebook Marketplace / OfferUp / Mercari): ONE full-width photo at a time,
 * swiped sideways (CSS scroll-snap, no library), dots for where you are, and
 * a tap opens the app's shared full-screen viewer (PhotoLightbox: pinch and
 * double-tap zoom, arrows, keyboard). No photos: the category icon on its
 * soft tint (PhotoPlaceholder), never a blank box.
 */
import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PhotoLightbox } from "@/components/dashboard/PhotoLightbox";
import { PhotoPlaceholder } from "@/components/ui/PhotoPlaceholder";
import { categoryIcon } from "@/lib/declutter/categoryIcons";

const FRAME = "relative aspect-square sm:aspect-[4/3] w-full overflow-hidden rounded-2xl bg-muted";

export function DeclutterGallery({ urls, category, title }: { urls: string[]; category: string; title: string }) {
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  if (urls.length === 0) {
    return (
      <div className={FRAME} data-gallery-empty="">
        <PhotoPlaceholder icon={categoryIcon(category)} seed={category} className="h-full w-full" />
      </div>
    );
  }
  const go = (i: number) => {
    const el = track.current;
    const next = Math.max(0, Math.min(urls.length - 1, i));
    if (el) el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
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
              <img
                src={url}
                alt={`Photo ${i + 1} of ${urls.length}`}
                loading={i === 0 ? "eager" : "lazy"}
                className="h-full w-full object-cover"
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
            <button
              type="button"
              aria-label="Previous photo"
              disabled={at === 0}
              onClick={() => go(at - 1)}
              className="absolute left-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity disabled:opacity-0 sm:flex"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next photo"
              disabled={at === urls.length - 1}
              onClick={() => go(at + 1)}
              className="absolute right-3 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm transition-opacity disabled:opacity-0 sm:flex"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </button>
          </>
        )}
      </div>
      {urls.length > 1 && (
        // Dots show where you are (swipe or the arrows move); the counter on the photo says it in words.
        <div className="flex justify-center gap-1.5" data-gallery-dots="" aria-hidden>
          {urls.map((url, i) => (
            <span key={url} data-dot-active={i === at ? "" : undefined} className={`block h-2 rounded-full transition-all ${i === at ? "w-4 bg-foreground/80" : "w-2 bg-foreground/25"}`} />
          ))}
        </div>
      )}
      <PhotoLightbox photos={urls} lightboxIndex={open} setLightboxIndex={setOpen} />
    </div>
  );
}
