import { OptimizedImage } from "@/components/ui/optimized-image";
import { useInAppPhotoViewer } from "@/components/useInAppPhotoViewer";
import { PhotoOpenButton } from "@/components/ui/PhotoOpenButton";

interface JobCardPhotoStripProps {
  urls: string[];
  /** Posted's photo strip uses md (112x80); Applied's uses sm (96x64). */
  size?: "sm" | "md";
  /** When true, each thumbnail's click stops propagation — Applied's
      pending section uses this because the surrounding card is itself a
      click target. Posted's strip is already inside a stopped subtree. */
  stopPropagation?: boolean;
}

const SIZES = {
  sm: { w: 96, h: 64, cls: "w-24 h-16" },
  md: { w: 112, h: 80, cls: "w-28 h-20" },
} as const;

/**
 * Horizontal photo thumbnail strip used in both activity cards. Renders
 * `null` when there are no photos so callers can drop the wrapping block
 * unconditionally.
 */
export function JobCardPhotoStrip({
  urls,
  size = "md",
  stopPropagation = false,
}: JobCardPhotoStripProps) {
  // Owner 11-13: a photo opens in the app's own viewer, never in Safari over the app.
  const { open, viewer } = useInAppPhotoViewer(urls, urls.map((_, i) => `Job photo ${i + 1}`));
  if (urls.length === 0) return null;
  const dims = SIZES[size];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {urls.map((url, i) => (
        <PhotoOpenButton
          key={i}
          // jobs.photos is writable by the job's poster (no shape CHECK): it is only ever an <img src> now (a src never
          // runs a script), never a link.
          aria-label={`Open job photo ${i + 1}`}
          className="flex-shrink-0 rounded-ds-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(e) => { if (stopPropagation) e.stopPropagation(); open(i); }}
        >
          <OptimizedImage
            src={url}
            width={dims.w}
            height={dims.h}
            alt={`Photo ${i + 1}`}
            fadeIn
            className={`${dims.cls} rounded-ds-sm object-cover border border-border hover:border-primary transition-colors`}
          />
        </PhotoOpenButton>
      ))}
      {/* The viewer's clicks bubble through React's portal to this strip's parents; stop them like the tiles do. */}
      {stopPropagation ? <span className="contents" onClick={(e) => e.stopPropagation()}>{viewer}</span> : viewer}
    </div>
  );
}
