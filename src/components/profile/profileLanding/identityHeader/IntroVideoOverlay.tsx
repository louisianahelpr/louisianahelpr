import { X } from "lucide-react";

/**
 * Fullscreen intro-video overlay — a pure presentational component. Receives
 * the video URL and a close callback via props; the parent owns the open
 * state and mount gate (it only renders this when a video exists and the
 * viewer tapped the thumbnail). Extracted verbatim from IdentityHeader.
 */
export function IntroVideoOverlay({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close video"
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full flex items-center justify-center"
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
