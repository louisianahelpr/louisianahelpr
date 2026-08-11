import { Label } from "@/components/ui/label";
import { ImagePlus, X, Plus, GripVertical } from "lucide-react";
import { Reorder } from "framer-motion";
import { useReducedMotion } from "@/lib/accessibility";

interface PhotoUploadProps {
  imagePreviews: string[];
  imageFiles: File[];
  onImageSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: (index: number) => void;
  uploadProgressByIndex?: Record<number, number>;
  onReorderImages?: (nextOrder: number[]) => void;
}

// Image Upload — brand-aligned thumbnail grid. Active photo tiles
// get a sienna delete pill (always visible on touch, since there
// is no hover state on mobile). The empty Add tile uses a
// parchment "+" badge with a soft inset shadow so it reads as
// tappable affordance, not chrome. Photos are optional but strongly
// nudged: label + inline copy frame them as a quality boost.
export function PhotoUpload({
  imagePreviews,
  imageFiles,
  onImageSelect,
  onRemoveImage,
  uploadProgressByIndex,
  onReorderImages,
}: PhotoUploadProps) {
  const reducedMotion = useReducedMotion();
  return (
    <div className="space-y-2.5">
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-2">
          <Label>
            Photos{" "}
            <span className="font-normal text-muted-foreground">(optional, up to 5)</span>
          </Label>
          {imageFiles.length > 0 && (
            <span className="text-ds-11 tabular-nums text-muted-foreground">
              {imageFiles.length}/5 photos
            </span>
          )}
        </div>
        <p className="text-ds-11 font-serif italic leading-snug" style={{ color: "hsl(var(--olivewood) / 0.85)" }}>
          Posts with a photo get noticeably more applicants.
        </p>
      </div>
      {/* Fixed-tile grid — 80px tiles wrap into rows. When the parent
          wired up `onReorderImages`, photos are draggable via
          framer-motion's Reorder; otherwise we fall back to the plain
          grid. The Add-tile is rendered outside Reorder so it doesn't
          get tangled in the drag state. */}
      {onReorderImages && imagePreviews.length > 1 ? (
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
                    boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.06), 0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
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
                    className="absolute -top-1 -right-1 h-10 w-10 flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
                  >
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center"
                      style={{
                        background: "hsl(var(--burnt-sienna))",
                        color: "hsl(var(--parchment))",
                        boxShadow: "0 1px 4px hsl(var(--burnt-sienna) / 0.40)",
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
            <label
              aria-label="Add another photo"
              className="mt-2.5 w-20 h-20 rounded-2xl flex items-center justify-center cursor-pointer transition-all active:scale-[0.97]"
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
                className="hidden"
                onChange={onImageSelect}
              />
            </label>
          )}
        </>
      ) : (
        <div
          id="photo-grid"
          className="grid gap-2.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, 80px)" }}
        >
          {imagePreviews.map((src, i) => {
            const progress = uploadProgressByIndex?.[i];
            const uploading = typeof progress === "number" && progress < 1;
            return (
              <div
                key={i}
                className="relative w-20 h-20 rounded-2xl overflow-hidden"
                style={{
                  border: "0.5px solid hsl(var(--olivewood) / 0.18)",
                  boxShadow: "0 1px 2px hsl(var(--olivewood) / 0.06), 0 6px 14px -4px hsl(var(--olivewood) / 0.12)",
                }}
              >
                {/^blob:/i.test(src) ? (
                  <img loading="lazy" decoding="async" src={src} alt="" aria-hidden="true" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: "hsl(var(--ivory-sand) / 0.6)" }}>
                    <ImagePlus className="w-5 h-5" style={{ color: "hsl(var(--olivewood) / 0.8)" }} />
                  </div>
                )}
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
                <button
                  type="button"
                  onClick={() => onRemoveImage(i)}
                  aria-label="Remove photo"
                  className="absolute -top-1 -right-1 h-10 w-10 flex items-center justify-center active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-full"
                >
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center"
                    style={{
                      background: "hsl(var(--burnt-sienna))",
                      color: "hsl(var(--parchment))",
                      boxShadow: "0 1px 4px hsl(var(--burnt-sienna) / 0.40)",
                    }}
                  >
                    <X className="w-3 h-3" strokeWidth={2.5} />
                  </span>
                </button>
              </div>
            );
          })}
          {imageFiles.length < 5 && (
            <label
              aria-label={imageFiles.length === 0 ? "Add a photo (optional)" : "Add another photo"}
              className="w-20 h-20 rounded-2xl flex items-center justify-center cursor-pointer transition-all active:scale-[0.97]"
              style={{
                background: "hsl(var(--parchment) / 0.7)",
                border: "0.5px solid hsl(var(--bark) / 0.28)",
                // Soft inset highlight + a tiny outer drop combine to
                // read as a tappable parchment chip instead of a flat
                // dashed placeholder.
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
                className="hidden"
                onChange={onImageSelect}
              />
            </label>
          )}
        </div>
      )}
      {/* An "Optional, but posts with a photo get more applicants and better
          quotes." line used to render here, directly beneath the near-identical
          "Posts with a photo get noticeably more applicants." above the picker.
          Two sentences, same claim, a few pixels apart — the second one is
          gone. */}
    </div>
  );
}
