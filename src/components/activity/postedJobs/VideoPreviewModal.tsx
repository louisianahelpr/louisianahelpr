import { useEffect, useRef } from "react";
import { X } from "lucide-react";

interface VideoPreviewModalProps {
  url: string;
  onClose: () => void;
}

/**
 * Video modal — shown when a poster taps a helper's intro video pill.
 *
 * This is a hand-rolled overlay rather than a Radix `Dialog`, because a
 * `<video>` inside `DialogContent` inherits the content's transform/animation
 * and WKWebView drops fullscreen playback when an ancestor is transformed. So
 * the dialog affordances Radix would have supplied have to be built here — and
 * previously none of them were: no dialog role, no accessible name, no focus
 * trap or restore, and crucially **no Escape handler**, so a keyboard user
 * could not close it at all.
 *
 * Pattern copied from `dashboard/PhotoLightbox.tsx` (role/aria-modal/aria-label
 * + a window keydown Escape listener), which is the canonical hand-rolled
 * overlay in this codebase.
 */
export function VideoPreviewModal({ url, onClose }: VideoPreviewModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Remember what had focus so it can be handed back on close — otherwise
  // focus falls to <body> and a keyboard user loses their place in the list.
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();

    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    window.addEventListener("keydown", handler);

    // Scroll-lock: without it the list behind the scrim scrolls under the
    // video. Restores the previous value rather than clearing it, so a nested
    // overlay can't leave the page permanently unscrollable.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handler);
      document.body.style.overflow = prevOverflow;
      restoreRef.current?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Intro video"
    >
      <button
        ref={closeRef}
        type="button"
        aria-label="Close video"
        onClick={onClose}
        className="absolute top-4 right-4 w-11 h-11 rounded-full flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.15)" }}
      >
        <X className="w-5 h-5 text-white" />
      </button>
      <video
        src={url}
        controls
        autoPlay
        playsInline
        className="w-full max-w-sm rounded-ds-md max-h-[70dvh] object-contain"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
