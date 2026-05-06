import { useEffect, useState } from "react";
import { FileText, ExternalLink, Loader2 } from "lucide-react";
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

  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const url = thumbUrl ?? (await getMessageAttachmentSignedUrl(path));
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const filename = getMessageAttachmentFilename(path);

  if (isImageMime(mime)) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="block max-w-xs overflow-hidden rounded-lg border border-border/40"
        aria-label={`Open ${filename}`}
      >
        {loading ? (
          <div className="flex items-center justify-center w-48 h-32 bg-muted">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : thumbUrl ? (
          <img loading="lazy" decoding="async"
            src={thumbUrl}
            alt={filename}
            className="max-w-xs max-h-64 object-cover"
          />
        ) : (
          <div className="flex items-center justify-center w-48 h-32 bg-muted text-xs text-muted-foreground">
            Failed to load
          </div>
        )}
      </button>
    );
  }

  if (isPdfMime(mime)) {
    const sizeKb = size ? `${(size / 1024).toFixed(0)} KB` : null;
    return (
      <button
        type="button"
        onClick={handleOpen}
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
          mine
            ? "bg-primary-foreground/15 hover:bg-primary-foreground/25 text-primary-foreground"
            : "bg-background/60 hover:bg-background text-foreground border border-border"
        }`}
      >
        <FileText className="w-4 h-4 shrink-0" />
        <span className="truncate max-w-[180px]">{filename}</span>
        {sizeKb && <span className="text-[10px] opacity-70 shrink-0">{sizeKb}</span>}
        <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
      </button>
    );
  }

  return null;
}
