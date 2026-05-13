import { useEffect, useState } from "react";
import { FileText, ExternalLink, Loader2, X } from "lucide-react";
import {
  getMessageAttachmentSignedUrl,
  getMessageAttachmentFilename,
  isImageMime,
  isPdfMime,
} from "@/lib/messageAttachments";

interface MessageAttachmentProps {
  /** Storage path on messages.attachment_url. Not a URL. */
  path: string;
  mime: string | null;
  size: number | null;
  /** Bubble owner controls light/dark text */
  mine?: boolean;
}

export function MessageAttachment({ path, mime, size, mine }: MessageAttachmentProps) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxOpen, setLightboxOpen] = useState(false);

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

  if (isImageMime(mime)) {
    return (
      <>
        <button
          type="button"
          onClick={handleOpenImageLightbox}
          className="block max-w-xs overflow-hidden rounded-2xl active:scale-[0.98] transition-transform"
          style={{
            border: `0.5px solid ${mine ? "hsl(var(--parchment) / 0.18)" : "hsl(var(--olivewood) / 0.18)"}`,
            boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.06), 0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
          }}
          aria-label={`Open ${filename}`}
        >
          {loading ? (
            <div
              className="flex items-center justify-center w-48 h-32"
              style={{ background: "hsl(var(--ivory-sand) / 0.5)" }}
            >
              <Loader2 className="w-4 h-4 animate-spin" style={{ color: "hsl(var(--olivewood) / 0.5)" }} />
            </div>
          ) : thumbUrl ? (
            <img loading="lazy" decoding="async"
              src={thumbUrl}
              alt={filename}
              className="max-w-xs max-h-64 object-cover block"
            />
          ) : (
            <div
              className="flex items-center justify-center w-48 h-32 font-serif italic"
              style={{ background: "hsl(var(--ivory-sand) / 0.5)", fontSize: "0.78rem", color: "hsl(var(--olivewood) / 0.7)" }}
            >
              Failed to load
            </div>
          )}
        </button>

        {/* Inline lightbox — frosted parchment backdrop matching the
            JobDetailDialog photo viewer. Click backdrop or X to close. */}
        {lightboxOpen && thumbUrl && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center animate-in fade-in-0 duration-200"
            style={{
              backgroundColor: "hsla(38, 18%, 12%, 0.55)",
              backdropFilter: "blur(28px) saturate(140%)",
              WebkitBackdropFilter: "blur(28px) saturate(140%)",
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
              className="max-h-[88vh] max-w-[92vw] object-contain rounded-lg select-none"
              style={{ boxShadow: "0 20px 60px -10px rgba(0, 0, 0, 0.5)" }}
              onClick={(e) => e.stopPropagation()}
              draggable={false}
            />
          </div>
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
        <span className="truncate max-w-[180px] font-sans font-semibold text-[0.78rem]">{filename}</span>
        {sizeKb && <span className="text-[0.65rem] opacity-70 shrink-0 font-sans tabular-nums">{sizeKb}</span>}
        <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
      </button>
    );
  }

  return null;
}
