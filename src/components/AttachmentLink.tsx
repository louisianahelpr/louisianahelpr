import { ListRow } from "@/components/ui/ListRow";
import { useState } from "react";
import { FileText, ExternalLink as ExternalLinkIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { getAttachmentSignedUrl, getAttachmentFilename, extractAttachmentPath } from "@/lib/applicationAttachments";
import { useInAppPhotoViewer } from "@/components/useInAppPhotoViewer";

interface AttachmentLinkProps {
  /** Either a storage path or a legacy public URL stored in applications.attachment_urls */
  url: string;
  index?: number;
  variant?: "thumb" | "chip";
  className?: string;
}

/**
 * Renders an application attachment with a signed URL fetched on demand.
 * Supports both image thumbnails (resolved on mount) and file chips (resolved on click).
 */
export function AttachmentLink({ url, index = 0, variant = "chip", className }: AttachmentLinkProps) {
  const filename = getAttachmentFilename(url, `File ${index + 1}`);
  const path = extractAttachmentPath(url);
  const isImage = /\.(jpg|jpeg|png|gif|webp)$/i.test(path);
  const [loading, setLoading] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  // Owner 11-13: an image attachment opens in the app's own viewer, never the signed URL in Safari. A file (PDF, doc)
  // still opens in the system viewer: the app has no document viewer of its own.
  const { open: openPhoto, viewer } = useInAppPhotoViewer([thumbUrl], [`Attachment ${index + 1}`]);

  // Lazy-load image thumbnails using a signed URL the first time they render
  if (isImage && variant === "thumb" && !thumbUrl && !loading) {
    setLoading(true);
    getAttachmentSignedUrl(url).then((signed) => {
      setThumbUrl(signed);
      setLoading(false);
    });
  }

  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const signed = await getAttachmentSignedUrl(url);
    if (!signed) {
      toast.error("Couldn't open that — try again?");
      return;
    }
    window.open(signed, "_blank", "noopener,noreferrer");
  };

  if (isImage && variant === "thumb") {
    return (
      <>
      <button
        type="button"
        disabled={!thumbUrl}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openPhoto(0); }}
        className={`flex-shrink-0 ${className ?? ""}`}
        aria-label={`Open ${filename}`}
      >
        {thumbUrl ? (
          <img loading="lazy" decoding="async"
            src={thumbUrl}
            alt={`Attachment ${index + 1}`}
            className="w-20 h-14 rounded-ds-sm object-cover border border-border hover:border-primary transition-colors"
          />
        ) : (
          <Skeleton className="w-20 h-14 rounded-ds-sm" />
        )}
      </button>
      {viewer}
      </>
    );
  }

  return (
    <ListRow variant="flush"
      onClick={handleOpen}
      className={`w-auto min-h-11 text-center flex items-center gap-1.5 text-ds-11 text-primary hover:underline bg-secondary/30 rounded-ds-sm px-2.5 py-1.5 ${className ?? ""}`}
    >
      <FileText className="w-3.5 h-3.5" />
      <span title={filename} className="truncate max-w-[120px]">{filename.length > 20 ? filename.slice(-20) : filename}</span>
      <ExternalLinkIcon className="w-3 h-3 text-muted-foreground" />
    </ListRow>
  );
}
