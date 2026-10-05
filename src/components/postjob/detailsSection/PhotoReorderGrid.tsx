import { ImagePlus, X, Plus, GripVertical } from "lucide-react";
import { Reorder } from "framer-motion";

/**
 * The drag-to-reorder photo grid of PhotoUpload. This file is the Post-a-Job
 * form's ONLY framer-motion import, loaded behind
 * `import("./PhotoReorderGrid")` once the poster has added a photo, so
 * /post-job draws its first frame without the framer chunk (Q1299,
 * check-deferred-vendors.mjs KNOWN_ROUTE_CLOSURE_VIOLATIONS). Reordering needs
 * two photos; until this arrives PhotoUpload shows its plain grid.
 */
export default function PhotoReorderGrid({
  imagePreviews,
  imageFiles,
  onImageSelect,
  onRemoveImage,
  uploadProgressByIndex,
  onReorderImages,
  reducedMotion,
}: {
  imagePreviews: string[];
  imageFiles: File[];
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: (index: number) => void;
  uploadProgressByIndex?: Record<number, number>;
  onReorderImages: (nextOrder: number[]) => void;
  reducedMotion: boolean;
}) {
  return (
    <>
      <Reorder.Group
        axis="x"
        values={imagePreviews.map((_, i) => i)}
        onReorder={(next) => onReorderImages(next as number[])}
        id="photo-grid"
        className="flex flex-wrap gap-2.5"
      >
        {imagePreviews.map((src, i) => {
          const progress = uploadProgressByIndex?.[i];
          const uploading = typeof progress === "number" && progress < 1;
          return (
            <Reorder.Item
              key={i}
              value={i}
              className="relative w-20 h-20 rounded-2xl overflow-hidden touch-none"
              style={{
                border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                boxShadow: "var(--elev-card)",
              }}
              whileDrag={reducedMotion ? {} : { scale: 1.05, zIndex: 5 }}
            >
              {/^blob:/i.test(src) ? (
                <img loading="lazy" decoding="async" src={src} alt="" aria-hidden="true" className="w-full h-full object-cover pointer-events-none" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: "hsl(var(--ivory-sand) / 0.6)" }}>
                  <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
                </div>
              )}
              {/* Per-image upload progress — bottom-edge bar. */}
              {uploading && (
                <div
                  className="absolute inset-x-0 bottom-0 h-1.5"
                  style={{ background: "hsl(var(--olivewood) / 0.18)" }}
                  aria-hidden
                >
                  <div
                    className="h-full transition-[width] duration-200"
                    style={{
                      width: `${Math.max(0, Math.min(1, progress ?? 0)) * 100}%`,
                      background: "hsl(var(--burnt-sienna))",
                    }}
                  />
                </div>
              )}
              {/* Drag handle — tiny grip in the bottom-left so
                  the photo itself stays tappable. */}
              <span
                aria-hidden
                className="absolute bottom-1 left-1 w-5 h-5 rounded-full flex items-center justify-center pointer-events-none"
                style={{
                  background: "hsl(var(--ink-deep) / 0.55)",
                  color: "hsl(var(--parchment))",
                }}
              >
                <GripVertical className="w-3 h-3" strokeWidth={2.5} />
              </span>
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onRemoveImage(i)}
                aria-label="Remove photo"
                className="absolute -top-1 -right-1 h-10 w-10 flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background rounded-full"
              >
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center"
                  style={{
                    background: "hsl(var(--burnt-sienna))",
                    color: "hsl(var(--parchment))",
                    boxShadow: "var(--elev-sienna-glow)",
                  }}
                >
                  <X className="w-3 h-3" strokeWidth={2.5} />
                </span>
              </button>
            </Reorder.Item>
          );
        })}
      </Reorder.Group>
      {imageFiles.length < 5 && (
        /* Focus is an OUTLINE here, not a ring: Tailwind's ring is a
           box-shadow, and this label paints its own inline boxShadow
           (the parchment chip), which wins over the class — the ring
           shipped in dbed7befd and never showed (2026-09-12). */
        <label
          className="mt-2.5 w-20 h-20 rounded-2xl flex items-center justify-center cursor-pointer transition-all active:scale-[0.97] focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[hsl(var(--bark)/0.45)]"
          style={{
            background: "hsl(var(--parchment) / 0.7)",
            border: "0.5px solid hsl(var(--bark) / 0.28)",
            boxShadow:
              "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
              "inset 0 -1px 2px 0 hsl(var(--olivewood) / 0.08), " +
              "0 1px 2px hsl(var(--olivewood) / 0.06)",
          }}
        >
          <Plus
            className="w-7 h-7"
            style={{ color: "hsl(var(--bark))" }}
            strokeWidth={2}
          />
          <input
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            aria-label="Add another photo"
            onChange={onImageSelect}
          />
        </label>
      )}
    </>
  );
}
