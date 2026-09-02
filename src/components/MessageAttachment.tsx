import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, ExternalLink, Loader2, X, Play, Pause } from "lucide-react";
import {
  getMessageAttachmentSignedUrl,
  getMessageAttachmentFilename,
  isImageMime,
  isPdfMime,
  isAudioMime,
} from "@/lib/messageAttachments";

interface MessageAttachmentProps {
  /** Storage path on messages.attachment_url. Not a URL. */
  path: string;
  mime: string | null;
  size: number | null;
  /** Duration in seconds for audio attachments. */
  duration?: number | null;
  /** Bubble owner controls light/dark text */
  mine?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Audio player bubble for voice notes. */
function AudioPlayer({
  path,
  duration,
  mine,
}: {
  path: string;
  duration?: number | null;
  mine?: boolean;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentSec, setCurrentSec] = useState(0);
  const [totalSec, setTotalSec] = useState(duration ?? 0);
  const [loading, setLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Resolve a signed URL on mount (audio can't play from a storage path).
  useEffect(() => {
    let cancelled = false;
    void getMessageAttachmentSignedUrl(path, 60 * 30).then((url) => {
      if (!cancelled) {
        setAudioUrl(url);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [path]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  };

  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentSec(Math.floor(audio.currentTime));
    if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
      setTotalSec(Math.floor(audio.duration));
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current;
    if (!audio || !totalSec) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = ratio * audio.duration;
  };

  const progress = totalSec > 0 ? currentSec / totalSec : 0;
  const displayTotal = totalSec > 0 ? totalSec : (duration ?? 0);
  const displayCurrent = playing ? currentSec : 0;

  const fgColor = mine ? "hsl(var(--parchment))" : "hsl(var(--bark))";
  const trackBg = mine ? "hsl(var(--parchment) / 0.22)" : "hsl(var(--bark) / 0.14)";
  const trackFill = mine ? "hsl(var(--parchment) / 0.75)" : "hsl(var(--bark) / 0.70)";

  return (
    <div
      className="flex items-center gap-2.5 rounded-2xl px-3 py-2.5 min-w-[180px] max-w-[240px]"
      style={{
        background: mine ? "hsl(var(--parchment) / 0.12)" : "hsl(var(--bark) / 0.07)",
        border: `0.5px solid ${mine ? "hsl(var(--parchment) / 0.22)" : "hsl(var(--olivewood) / 0.16)"}`,
      }}
    >
      {/* Hidden <audio> element — we drive it imperatively */}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCurrentSec(0); }}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleTimeUpdate}
        />
      )}

      {/* Play / Pause button */}
      <button
        type="button"
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        onClick={togglePlay}
        disabled={loading || !audioUrl}
        className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90"
        style={{
          background: fgColor,
          opacity: loading ? 0.5 : 1,
        }}
      >
        {loading ? (
          <Loader2
            className="w-4 h-4 animate-spin"
            style={{ color: mine ? "hsl(var(--bark))" : "hsl(var(--parchment))" }}
          />
        ) : playing ? (
          <Pause
            className="w-4 h-4"
            style={{ color: mine ? "hsl(var(--bark))" : "hsl(var(--parchment))" }}
          />
        ) : (
          <Play
            className="w-4 h-4 ml-0.5"
            style={{ color: mine ? "hsl(var(--bark))" : "hsl(var(--parchment))" }}
          />
        )}
      </button>

      {/* Progress track + time */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        {/* Scrub bar */}
        <div
          className="relative h-1.5 rounded-full cursor-pointer overflow-hidden"
          style={{ background: trackBg }}
          onClick={handleSeek}
          role="progressbar"
          aria-valuenow={Math.round(progress * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all"
            style={{ width: `${progress * 100}%`, background: trackFill }}
          />
        </div>
        {/* Time display */}
        <span
          className="text-ds-10 tabular-nums font-sans"
          style={{ color: mine ? "hsl(var(--parchment) / 0.75)" : "hsl(var(--olivewood))" }}
        >
          {playing
            ? `${formatDuration(displayCurrent)} / ${formatDuration(displayTotal)}`
            : formatDuration(displayTotal)}
        </span>
      </div>
    </div>
  );
}

export function MessageAttachment({ path, mime, size, duration, mine }: MessageAttachmentProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const thumbRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const lightboxRef = useRef<HTMLDivElement>(null);

  // Keep the viewer visible to assistive tech. Same trap as
  // PhotoLightbox.tsx (dashboard/PhotoLightbox.tsx): an open Radix modal
  // calls hideOthers() (the `aria-hidden` package), which stamps
  // `aria-hidden="true"` on every <body> child that isn't the dialog — and
  // keeps doing so for nodes added afterwards, including this portal. The
  // `pointerEvents: "auto"` override a few lines below exists because this
  // exact "lightbox open while another Radix modal is active" scenario was
  // already reproduced once, on the twin PhotoLightbox viewer opened inside
  // JobDetailDialog — only the pointer-events half of that fix had been
  // ported here. Un-hide ourselves and hold it.
  useEffect(() => {
    const el = lightboxRef.current;
    if (!lightboxOpen || !el) return;
    const unhide = () => {
      if (el.getAttribute("aria-hidden") === "true") {
        el.removeAttribute("aria-hidden");
        el.removeAttribute("data-aria-hidden");
      }
    };
    unhide();
    const mo = new MutationObserver(unhide);
    mo.observe(el, { attributes: true, attributeFilter: ["aria-hidden"] });
    return () => mo.disconnect();
  }, [lightboxOpen]);

  // ESC to close the lightbox (keyboard parity with JobDetailDialog's
  // photo viewer, which uses the same pattern).
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxOpen]);

  // Focus return. The viewer is a portal at the END of <body>, so once it
  // unmounts there is nothing between the caret and the top of the document —
  // without this, Escape drops focus onto <body> and the next Tab restarts at
  // the skip link rather than at the message the photo belongs to.
  useEffect(() => {
    if (lightboxOpen) {
      wasOpenRef.current = true;
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      thumbRef.current?.focus();
    }
  }, [lightboxOpen]);

  // Image thumbnails: resolve a signed URL on mount. PDFs: defer the signed
  // URL until the user clicks (saves a round-trip if they never open it).
  useEffect(() => {
    if (!isImageMime(mime)) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void getMessageAttachmentSignedUrl(path).then((url) => {
      if (!cancelled) {
        setThumbUrl(url);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [path, mime]);

  const handleOpenImageLightbox = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLightboxOpen(true);
  };

  const handleOpenExternal = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = thumbUrl ?? (await getMessageAttachmentSignedUrl(path));
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const filename = getMessageAttachmentFilename(path);

  if (isAudioMime(mime)) {
    return <AudioPlayer path={path} duration={duration} mine={mine} />;
  }

  if (isImageMime(mime)) {
    return (
      <>
        <button
          ref={thumbRef}
          type="button"
          onClick={handleOpenImageLightbox}
          className="block max-w-xs overflow-hidden rounded-2xl active:scale-[0.98] transition-transform"
          style={{
            border: `0.5px solid ${mine ? "hsl(var(--parchment) / 0.18)" : "hsl(var(--olivewood) / 0.18)"}`,
            boxShadow: "var(--elev-card)",
          }}
          aria-label={`Open ${filename}`}
        >
          {loading ? (
            <div
              className="flex items-center justify-center w-48 h-32"
              style={{ background: "hsl(var(--ivory-sand) / 0.5)" }}
            >
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
            </div>
          ) : thumbUrl ? (
            <img loading="lazy" decoding="async"
              src={thumbUrl}
              alt={filename}
              className="max-w-xs max-h-64 object-cover block"
            />
          ) : (
            <div
              className="flex items-center justify-center w-48 h-32 font-serif italic text-ds-12"
              style={{ background: "hsl(var(--ivory-sand) / 0.5)", color: "hsl(var(--olivewood) / 0.8)" }}
            >
              Couldn't Load Photo
            </div>
          )}
        </button>

        {/* Lightbox — frosted parchment backdrop matching the JobDetailDialog
            photo viewer. Click backdrop or X to close.
            PORTALLED TO <body>, and that is load-bearing rather than tidy.
            `position: fixed` resolves against the VIEWPORT only while no
            ancestor establishes a containing block, and one does: this bubble
            renders inside PageScaffold's panel, whose `.liquid-glass` carries
            `backdrop-filter: blur(20px) saturate(170%)` (index.css) — a
            non-none filter makes an element the containing block for every
            fixed descendant, exactly as a transform does. Rendered inline,
            `inset-0` therefore sized the "full-screen" viewer to the CHAT
            PANEL and the panel's own `overflow: hidden` then clipped it:
            measured 351x767 at (21, 85) in a 393x852 viewport — 89% of the
            width, 90% of the height, inset under the title card. Same class of
            bug as the "Add a Pet" sheet (see the note in
            src/pages/petProfiles/PetForm.tsx), same fix: leave the transformed
            subtree by construction instead of hoping no ancestor ever gains a
            filter or a transform.
            A plain portal, not the shared <Dialog>: this file is on
            popupShellInventory.test.ts's HAND_ROLLED_BY_DESIGN list because
            framing a photo in a 512px titled card to satisfy a consistency
            rule makes the photo worse. */}
        {lightboxOpen && thumbUrl && createPortal(
          <div
            ref={lightboxRef}
            className="fixed inset-0 z-[60] flex items-center justify-center animate-in fade-in-0 duration-200"
            style={{
              backgroundColor: "hsla(38, 18%, 12%, 0.55)",
              backdropFilter: "blur(28px) saturate(140%)",
              WebkitBackdropFilter: "blur(28px) saturate(140%)",
              // Required by the portal above. Any open Radix modal sets
              // `pointer-events: none` on <body>, and `pointer-events`
              // inherits — so a portal appended to <body> while one is open
              // renders at full size and is completely inert. Measured on the
              // twin viewer in PhotoLightbox.tsx, which had exactly that
              // failure inside JobDetailDialog.
              pointerEvents: "auto",
            }}
            onClick={() => setLightboxOpen(false)}
            role="dialog"
            aria-modal="true"
            aria-label="Photo viewer"
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
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
            <img
              loading="lazy"
              decoding="async"
              src={thumbUrl}
              alt={filename}
              className="max-h-[88vh] max-w-[92vw] object-contain rounded-ds-sm select-none"
              style={{ boxShadow: "0 20px 60px -10px rgba(0, 0, 0, 0.5)" }}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          </div>,
          document.body,
        )}
      </>
    );
  }

  if (isPdfMime(mime)) {
    const sizeKb = size ? `${(size / 1024).toFixed(0)} KB` : null;
    return (
      <button
        type="button"
        onClick={handleOpenExternal}
        className="flex items-center gap-2 rounded-2xl px-3 py-2 transition-all active:scale-[0.98]"
        style={
          mine
            ? {
                background: "hsl(var(--parchment) / 0.18)",
                color: "hsl(var(--parchment))",
                border: "0.5px solid hsl(var(--parchment) / 0.28)",
              }
            : {
                background: "hsl(var(--bark) / 0.06)",
                color: "hsl(var(--ink-deep))",
                border: "0.5px solid hsl(var(--olivewood) / 0.18)",
              }
        }
      >
        <FileText className="w-4 h-4 shrink-0" strokeWidth={2.25} />
        <span className="truncate max-w-[180px] font-sans font-semibold text-ds-12">{filename}</span>
        {sizeKb && <span className="text-ds-10 opacity-70 shrink-0 font-sans tabular-nums">{sizeKb}</span>}
        <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
      </button>
    );
  }

  return null;
}
