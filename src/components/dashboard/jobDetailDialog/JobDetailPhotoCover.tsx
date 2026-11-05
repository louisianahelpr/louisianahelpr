import type { Dispatch, SetStateAction } from "react";
import { OptimizedImage } from "@/components/ui/optimized-image";

/* Moved verbatim from JobDetailDialog.tsx (Q806 god-component ratchet, a pure move: the sheet's DOM is byte-identical). */

export function JobDetailPhotoCover({ photos, setLightboxIndex, setGridOpenNonce }: {
  photos: string[];
  setLightboxIndex: Dispatch<SetStateAction<number | null>>;
  setGridOpenNonce: Dispatch<SetStateAction<number>>;
}) {
  return (
        <div className="relative">
          <button
            type="button"
            onClick={() => setLightboxIndex(0)}
            aria-label="View photos"
            className="relative block w-full aspect-video rounded-ds-md overflow-hidden group"
            style={{
              border: "0.5px solid hsl(var(--bark) / 0.22)",
              boxShadow:
                "inset 0 0 0 1px rgba(255, 255, 255, 0.5), " +
                "0 1px 2px hsl(var(--olivewood) / 0.08), " +
                "0 8px 24px -6px hsl(var(--bark) / 0.18)",
            }}
          >
            {/* 16:9 cover inside a max-w-lg (512px) dialog — request a
                ~512x288 thumbnail (via Supabase render + Vercel edge)
                instead of the raw upload. The wrapper is `aspect-video`,
                so the box is already CLS-safe. */}
            <OptimizedImage src={photos[0]} width={512} height={288} alt="Cover" fadeIn className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
            {photos.length > 1 && (
              <span
                className="absolute bottom-2 right-2 px-2 py-0.5 rounded-full text-ds-10 font-sans font-semibold"
                style={{
                  backgroundColor: "var(--glass-bg-strong)",
                  backdropFilter: "blur(12px) saturate(150%)",
                  WebkitBackdropFilter: "blur(12px) saturate(150%)",
                  color: "hsl(var(--ink-deep))",
                  border: "0.5px solid var(--glass-border)",
                  boxShadow: "0 1px 4px hsl(var(--bark) / 0.18)",
                }}
              >
                +{photos.length - 1} more
              </span>
            )}
          </button>
          {/* "View all" — opens the lightbox straight into grid mode
              so a helpr can scan a project with lots of reference
              shots without tapping next/next/next. */}
          {photos.length > 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setGridOpenNonce((n) => n + 1);
                setLightboxIndex(0);
              }}
              aria-label="View all photos in a grid"
              className="absolute bottom-2 left-2 inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-ds-12 font-sans font-semibold transition-transform active:scale-95 hover:scale-105"
              style={{
                backgroundColor: "var(--glass-bg-strong)",
                backdropFilter: "blur(12px) saturate(150%)",
                WebkitBackdropFilter: "blur(12px) saturate(150%)",
                color: "hsl(var(--ink-deep))",
                border: "0.5px solid var(--glass-border)",
                boxShadow: "0 1px 4px hsl(var(--bark) / 0.18)",
              }}
            >
              View all
            </button>
          )}
        </div>
  );
}
