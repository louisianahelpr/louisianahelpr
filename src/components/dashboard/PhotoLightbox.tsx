import { useEffect, type Dispatch, type SetStateAction } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface PhotoLightboxProps {
  /** All photos for the job. */
  photos: string[];
  /** Index of the open photo, or null when the lightbox is closed. */
  lightboxIndex: number | null;
  setLightboxIndex: Dispatch<SetStateAction<number | null>>;
}

/**
 * PhotoLightbox — the fullscreen photo carousel for JobDetailDialog: a
 * frosted scrim, a counter, prev/next arrows, keyboard navigation, and
 * a thumbnail strip. Renders nothing when lightboxIndex is null.
 *
 * Extracted verbatim from JobDetailDialog.tsx — the carousel JSX is
 * unchanged; the keyboard-nav effect moved in with it.
 */
export function PhotoLightbox({ photos, lightboxIndex, setLightboxIndex }: PhotoLightboxProps) {
  // Lightbox keyboard navigation: arrows + escape.
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxIndex(null);
      if (e.key === "ArrowRight") setLightboxIndex((i) => (i === null ? null : Math.min(i + 1, photos.length - 1)));
      if (e.key === "ArrowLeft") setLightboxIndex((i) => (i === null ? null : Math.max(i - 1, 0)));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, photos.length]);

  if (lightboxIndex === null || photos.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center animate-in fade-in-0 duration-200"
      style={{
        // Frosted parchment scrim — heavy blur of whatever's underneath
        // (the dialog) with a soft warm tint. Replaces the heavy black box.
        backgroundColor: "hsla(38, 18%, 12%, 0.55)",
        backdropFilter: "blur(28px) saturate(140%)",
        WebkitBackdropFilter: "blur(28px) saturate(140%)",
      }}
      onClick={() => setLightboxIndex(null)}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      {/* Counter — top-left */}
      <div
        className="absolute top-4 left-4 px-2.5 py-1 rounded-full text-[11px] font-sans font-semibold tracking-[0.06em]"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.12)",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          border: "0.5px solid rgba(255, 255, 255, 0.2)",
          color: "rgba(255, 255, 255, 0.9)",
        }}
      >
        {lightboxIndex + 1} / {photos.length}
      </div>

      {/* Close X — top-right */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setLightboxIndex(null); }}
        aria-label="Close photo viewer"
        className="absolute top-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95"
        style={{
          backgroundColor: "rgba(255, 255, 255, 0.12)",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          border: "0.5px solid rgba(255, 255, 255, 0.2)",
          color: "white",
        }}
      >
        <X className="w-5 h-5" />
      </button>

      {/* Prev arrow */}
      {lightboxIndex > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => Math.max((i ?? 0) - 1, 0)); }}
          aria-label="Previous photo"
          className="absolute left-3 sm:left-6 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.14)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            border: "0.5px solid rgba(255, 255, 255, 0.22)",
            color: "white",
          }}
        >
          <ChevronLeft className="w-6 h-6" />
        </button>
      )}

      {/* Image */}
      <img loading="lazy" decoding="async"
        src={photos[lightboxIndex]}
        alt={`Photo ${lightboxIndex + 1}`}
        className="max-h-[88vh] max-w-[92vw] object-contain rounded-lg select-none"
        style={{ boxShadow: "0 20px 60px -10px rgba(0, 0, 0, 0.5)" }}
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />

      {/* Next arrow */}
      {lightboxIndex < photos.length - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setLightboxIndex((i) => Math.min((i ?? 0) + 1, photos.length - 1)); }}
          aria-label="Next photo"
          className="absolute right-3 sm:right-6 w-11 h-11 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.14)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            border: "0.5px solid rgba(255, 255, 255, 0.22)",
            color: "white",
          }}
        >
          <ChevronRight className="w-6 h-6" />
        </button>
      )}

      {/* Thumbnail strip — bottom, only when multiple photos */}
      {photos.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 px-2 py-1.5 rounded-full max-w-[90vw] overflow-x-auto scrollbar-hide"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.10)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            border: "0.5px solid rgba(255, 255, 255, 0.18)",
          }}
        >
          {photos.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
              aria-label={`Photo ${i + 1}`}
              className={`shrink-0 w-10 h-10 rounded-md overflow-hidden transition-all ${i === lightboxIndex ? "ring-2 ring-white scale-105" : "opacity-60 hover:opacity-100"}`}
            >
              <img loading="lazy" decoding="async" src={url} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
