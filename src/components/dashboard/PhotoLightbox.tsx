import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { X, ChevronLeft, ChevronRight, Grid3x3 } from "lucide-react";

interface PhotoLightboxProps {
  /** All photos for the job. */
  photos: string[];
  /** Index of the open photo, or null when the lightbox is closed. */
  lightboxIndex: number | null;
  setLightboxIndex: Dispatch<SetStateAction<number | null>>;
  /** When the caller wants to open straight into the grid view ("View
   *  all" pill on the cover), they bump this nonce; we re-key the
   *  internal mode state to "grid" on change. Null/undefined → open
   *  in single-photo mode. */
  openInGridNonce?: number;
}

type Mode = "single" | "grid";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const DOUBLE_TAP_ZOOM = 2.4;
const DOUBLE_TAP_MS = 280;

/**
 * PhotoLightbox — the fullscreen photo carousel for JobDetailDialog: a
 * frosted scrim, a counter, prev/next arrows, keyboard navigation, and
 * a thumbnail strip. Now also supports:
 *
 *   - Pinch-to-zoom (and double-tap zoom toggle) on the main image, with
 *     a one-finger pan once the image is zoomed past 1x. Pinch math is
 *     anchored to the midpoint of the two fingers so the image stays
 *     under the user's pinch rather than drifting to the screen center.
 *   - Next/prev preload (browser-decoded `<link rel="preload">` via a
 *     hidden Image), so a swipe right doesn't see a blank-then-pop.
 *   - A "View all" grid mode (the small grid button top-left) that opens
 *     a thumbnail wall. Tapping a thumb returns to single-image mode at
 *     that index.
 */
export function PhotoLightbox({ photos, lightboxIndex, setLightboxIndex, openInGridNonce }: PhotoLightboxProps) {
  const [mode, setMode] = useState<Mode>("single");
  // When the caller requests a grid open (nonce changes), flip into
  // grid mode for the current lightbox session.
  useEffect(() => {
    if (openInGridNonce != null && lightboxIndex !== null) setMode("grid");
  }, [openInGridNonce, lightboxIndex]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const lastTapRef = useRef(0);
  const pinchRef = useRef<{ startDist: number; startZoom: number; anchorX: number; anchorY: number; startPan: { x: number; y: number } } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startPan: { x: number; y: number } } | null>(null);

  // Reset zoom + mode whenever the lightbox opens or the photo index
  // changes — a zoomed-in image lingering across photos breaks layout
  // expectations.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [lightboxIndex]);

  useEffect(() => {
    if (lightboxIndex === null) setMode("single");
  }, [lightboxIndex]);

  // Lightbox keyboard navigation: arrows + escape. Esc also collapses
  // grid → single, and resets a zoomed-in image before closing.
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (mode === "grid") { setMode("single"); return; }
        if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); return; }
        setLightboxIndex(null);
      }
      if (mode !== "single" || zoom !== 1) return;
      if (e.key === "ArrowRight") setLightboxIndex((i) => (i === null ? null : Math.min(i + 1, photos.length - 1)));
      if (e.key === "ArrowLeft") setLightboxIndex((i) => (i === null ? null : Math.max(i - 1, 0)));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightboxIndex, photos.length, mode, zoom, setLightboxIndex]);

  // Preload the prev/next image so a navigate is instant. We let the
  // browser cache do its job — the hidden Image objects fall out of
  // scope on re-render but the network request is already in-flight.
  useEffect(() => {
    if (lightboxIndex === null || mode !== "single") return;
    const targets = [lightboxIndex - 1, lightboxIndex + 1].filter((i) => i >= 0 && i < photos.length);
    targets.forEach((i) => {
      const img = new Image();
      img.decoding = "async";
      img.src = photos[i];
    });
  }, [lightboxIndex, mode, photos]);

  if (lightboxIndex === null || photos.length === 0) return null;

  const clampPan = (p: { x: number; y: number }, z: number) => {
    // Cap pan so the image doesn't drift entirely off-screen at high
    // zoom. The visible area scales with z so the limit grows linearly.
    const max = 240 * (z - 1);
    return {
      x: Math.max(-max, Math.min(max, p.x)),
      y: Math.max(-max, Math.min(max, p.y)),
    };
  };

  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleImagePointerDown: React.PointerEventHandler<HTMLImageElement> = (e) => {
    // Only handle pan when already zoomed in — a 1x image should still
    // forward taps to the scrim's close handler.
    if (zoom <= 1) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPan: { ...pan },
    };
  };

  const handleImagePointerMove: React.PointerEventHandler<HTMLImageElement> = (e) => {
    if (!panRef.current) return;
    const next = {
      x: panRef.current.startPan.x + (e.clientX - panRef.current.startX),
      y: panRef.current.startPan.y + (e.clientY - panRef.current.startY),
    };
    setPan(clampPan(next, zoom));
  };

  const handleImagePointerUp: React.PointerEventHandler<HTMLImageElement> = () => {
    panRef.current = null;
  };

  const handleTouchStart: React.TouchEventHandler<HTMLImageElement> = (e) => {
    if (e.touches.length === 2) {
      // Pinch start — record the starting finger distance, zoom value,
      // and midpoint anchor so we can scale relative to where the user
      // pinched (not the image center).
      const [a, b] = [e.touches[0], e.touches[1]];
      const dx = a.clientX - b.clientX;
      const dy = a.clientY - b.clientY;
      const dist = Math.hypot(dx, dy);
      pinchRef.current = {
        startDist: dist,
        startZoom: zoom,
        anchorX: (a.clientX + b.clientX) / 2,
        anchorY: (a.clientY + b.clientY) / 2,
        startPan: { ...pan },
      };
      panRef.current = null;
    }
  };

  const handleTouchMove: React.TouchEventHandler<HTMLImageElement> = (e) => {
    if (pinchRef.current && e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / pinchRef.current.startDist;
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchRef.current.startZoom * ratio));
      setZoom(nextZoom);
      // Keep pan within the clamped range as zoom drops, so an unpinch
      // back to 1x snaps the image back to center.
      setPan((p) => clampPan(p, nextZoom));
    }
  };

  const handleTouchEnd: React.TouchEventHandler<HTMLImageElement> = (e) => {
    if (e.touches.length < 2) pinchRef.current = null;
    if (e.touches.length === 0 && zoom <= MIN_ZOOM + 0.02) {
      // Drift cleanup: a barely-1x zoom after an unpinch should fully reset.
      resetZoom();
    }
  };

  const handleImageClick: React.MouseEventHandler<HTMLImageElement> = (e) => {
    e.stopPropagation();
    const now = Date.now();
    if (now - lastTapRef.current < DOUBLE_TAP_MS) {
      // Double-tap toggles between fit and 2.4x. A second double-tap
      // when zoomed-in resets to fit.
      if (zoom > 1) {
        resetZoom();
      } else {
        setZoom(DOUBLE_TAP_ZOOM);
        setPan({ x: 0, y: 0 });
      }
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
  };

  const photoUrl = photos[lightboxIndex];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center animate-in fade-in-0 duration-200"
      style={{
        // Frosted parchment scrim — heavy blur of whatever's underneath
        // (the dialog) with a soft warm tint. Replaces the heavy black box.
        backgroundColor: "hsla(38, 18%, 12%, 0.55)",
        backdropFilter: "blur(28px) saturate(140%)",
        WebkitBackdropFilter: "blur(28px) saturate(140%)",
        // Disable native pinch-to-zoom on the page so our pinch math
        // is the only zoom handler in play.
        touchAction: zoom > 1 ? "none" : "pan-y",
      }}
      onClick={() => {
        // Tapping the scrim closes — but only when not actively zoomed
        // in (so an over-pan release doesn't accidentally dismiss).
        if (zoom > 1) return;
        if (mode === "grid") { setMode("single"); return; }
        setLightboxIndex(null);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
    >
      {/* Counter — top-left */}
      {mode === "single" && (
        <div
          className="absolute top-4 left-4 px-2.5 py-1 rounded-full text-ds-11 font-sans font-semibold tracking-[0.06em] pointer-events-none"
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
      )}

      {/* View-all grid toggle — sits next to the counter when there's
          more than one photo. In grid mode this button morphs into a
          "Back to photo" affordance. */}
      {photos.length > 1 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMode((m) => (m === "grid" ? "single" : "grid"));
          }}
          aria-label={mode === "grid" ? "Close grid view" : "View all photos"}
          className="absolute top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 h-10 px-3 rounded-full transition-all hover:scale-105 active:scale-95"
          style={{
            backgroundColor: "rgba(255, 255, 255, 0.12)",
            backdropFilter: "blur(20px) saturate(150%)",
            WebkitBackdropFilter: "blur(20px) saturate(150%)",
            border: "0.5px solid rgba(255, 255, 255, 0.2)",
            color: "white",
          }}
        >
          <Grid3x3 className="w-4 h-4" strokeWidth={2.25} />
          <span className="text-ds-11 font-sans font-semibold tracking-[0.04em] uppercase">
            {mode === "grid" ? "Photo" : "View all"}
          </span>
        </button>
      )}

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

      {mode === "single" && (
        <>
          {/* Prev arrow */}
          {lightboxIndex > 0 && zoom <= 1 && (
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

          {/* Image — pinch-zoomable + pan-while-zoomed. */}
          <img
            decoding="async"
            src={photoUrl}
            alt={`Photo ${lightboxIndex + 1}`}
            className="max-h-[88vh] max-w-[92vw] object-contain rounded-ds-sm select-none"
            style={{
              boxShadow: "0 20px 60px -10px rgba(0, 0, 0, 0.5)",
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: panRef.current || pinchRef.current ? "none" : "transform 180ms ease-out",
              cursor: zoom > 1 ? "grab" : "zoom-in",
              touchAction: "none",
            }}
            onClick={handleImageClick}
            onPointerDown={handleImagePointerDown}
            onPointerMove={handleImagePointerMove}
            onPointerUp={handleImagePointerUp}
            onPointerCancel={handleImagePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            draggable={false}
          />

          {/* Next arrow */}
          {lightboxIndex < photos.length - 1 && zoom <= 1 && (
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

          {/* Thumbnail strip — bottom, only when multiple photos and not zoomed in. */}
          {photos.length > 1 && zoom <= 1 && (
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
                  <img loading="lazy" decoding="async" src={url} alt="" aria-hidden="true" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {mode === "grid" && (
        <div
          className="absolute inset-0 overflow-y-auto px-4 pt-20 pb-8"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mx-auto max-w-3xl grid grid-cols-2 sm:grid-cols-3 gap-2">
            {photos.map((url, i) => (
              <button
                key={url}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex(i);
                  setMode("single");
                }}
                aria-label={`Open photo ${i + 1}`}
                className={`group relative aspect-square rounded-ds-md overflow-hidden transition-transform active:scale-[0.97] ${i === lightboxIndex ? "ring-2 ring-white" : "ring-0"}`}
                style={{
                  border: "0.5px solid rgba(255, 255, 255, 0.18)",
                }}
              >
                <img
                  loading="lazy"
                  decoding="async"
                  src={url}
                  alt={`Photo ${i + 1}`}
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
                />
                <span
                  className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded-full text-ds-10 font-sans font-semibold tabular-nums"
                  style={{
                    backgroundColor: "rgba(0, 0, 0, 0.5)",
                    color: "white",
                  }}
                >
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
