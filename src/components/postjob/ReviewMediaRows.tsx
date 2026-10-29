import { ImagePlus, Video } from "lucide-react";
import { ScopeVideo } from "@/components/jobs/ScopeVideo";
import { safeScopeVideoUrl } from "@/lib/scopeVideo";
import { isSafeBlobPreviewUrl } from "./safeBlobPreviewUrl";

/**
 * The post-job Review step's media rows: the photo thumbnails (moved out of
 * CheckoutStep.tsx unchanged) and, under them, the scope video the poster
 * picked (A2-B6: it was uploaded with the job and shown nowhere, this step
 * included). Each row is absent when there is nothing to show.
 */
export function ReviewMediaRows({ imagePreviews, scopeVideoUrl }: { imagePreviews: string[]; scopeVideoUrl?: string | null }) {
  return (
    <>
      {/* Photos (thumbnail row) */}
      {imagePreviews.length > 0 && (
        <div className="px-4 py-3 flex items-start gap-3">
          <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
            <ImagePlus className="w-3 h-3" />Photos
          </span>
          <div className="flex-1 flex gap-1.5 flex-wrap justify-end">
            {imagePreviews.slice(0, 5).map((src, i) =>
              isSafeBlobPreviewUrl(src) ? (
                <img
                  loading="lazy"
                  decoding="async"
                  key={i}
                  src={src}
                  alt=""
                  className="w-10 h-10 rounded-ds-sm object-cover"
                  style={{ border: "0.5px solid hsl(var(--olivewood) / 0.15)" }}
                />
              ) : null,
            )}
          </div>
        </div>
      )}

      {/* Scope video: the picked clip's blob: preview, playable before posting. */}
      {safeScopeVideoUrl(scopeVideoUrl) && (
        <div className="px-4 py-3 flex items-start gap-3">
          <span className="text-ds-12 text-muted-foreground w-20 shrink-0 pt-0.5 flex items-center gap-1">
            <Video className="w-3 h-3" />Video
          </span>
          <div className="flex-1 min-w-0">
            <ScopeVideo url={scopeVideoUrl} />
          </div>
        </div>
      )}
    </>
  );
}
