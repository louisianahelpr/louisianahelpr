import { OptimizedImage } from "@/components/ui/optimized-image";

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
  if (urls.length === 0) return null;
  const dims = SIZES[size];
  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {urls.map((url, i) => (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0"
          onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
        >
          <OptimizedImage
            src={url}
            width={dims.w}
            height={dims.h}
            alt={`Photo ${i + 1}`}
            fadeIn
            className={`${dims.cls} rounded-ds-sm object-cover border border-border hover:border-primary transition-colors`}
          />
        </a>
      ))}
    </div>
  );
}
