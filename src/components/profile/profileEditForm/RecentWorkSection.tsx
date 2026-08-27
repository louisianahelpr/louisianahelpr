import { Loader2, ImagePlus, X } from "lucide-react";
import { MAX_PORTFOLIO } from "./usePortfolio";

interface RecentWorkSectionProps {
  /** DOM id so the profile-completion checklist can scroll here. */
  anchorId?: string;
  portfolioUrls: string[];
  portfolioUploading: boolean;
  portfolioInputRef: React.RefObject<HTMLInputElement>;
  handlePortfolioPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  removePortfolioAt: (i: number) => void;
}

/**
 * Work portfolio — photos of previous work shown on the public profile when
 * applicants are deciding who to hire. Up to 6 images, 5MB each, JPG/PNG/WEBP.
 * Uses the public `avatars` bucket path-scoped to the user's id. The user
 * explicitly asked for this in their Edit-profile screenshot review.
 */
export function RecentWorkSection({
  anchorId,
  portfolioUrls,
  portfolioUploading,
  portfolioInputRef,
  handlePortfolioPick,
  removePortfolioAt,
}: RecentWorkSectionProps) {
  return (
    <div id={anchorId} className="rounded-2xl liquid-glass p-5 space-y-4 scroll-mt-24">
      {/* Titled — the counter used to float alone on the right, so the card
          opened with "0/6" and no word saying what it counted. */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-ds-13 font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>
          Recent work
        </h3>
        <span className="text-ds-11 text-muted-foreground">{portfolioUrls.length}/{MAX_PORTFOLIO}</span>
      </div>
      {/* One paragraph, ONE typeface. The emphasis span used to carry
          `not-italic font-sans`, so the sentence broke mid-paragraph from
          serif italic into upright sans — two fonts inside one block of copy.
          Emphasis now rides weight + colour while the family stays put, which
          is the pattern the rest of this form already uses (see the "Next: …"
          line in ProfileEditForm). */}
      <p className="font-serif italic leading-snug -mt-1 text-ds-12" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Show off recent jobs — applicants see these when deciding to apply.
        {" "}<span className="font-semibold" style={{ color: "hsl(var(--ink-deep))" }}>Photos save automatically.</span>
      </p>
      <div className="grid grid-cols-3 gap-2">
        {portfolioUrls.map((url, i) => (
          <div key={url} className="relative aspect-square rounded-2xl overflow-hidden border border-border/60 group">
            <img
              loading="lazy"
              decoding="async"
              src={url}
              alt={`Work sample ${i + 1}`}
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={() => removePortfolioAt(i)}
              aria-label="Remove this photo"
              className="absolute top-0.5 right-0.5 w-9 h-9 rounded-full flex items-center justify-center active:scale-90 transition-transform"
              style={{
                background: "hsla(0, 0%, 0%, 0.55)",
                backdropFilter: "blur(6px)",
                WebkitBackdropFilter: "blur(6px)",
              }}
            >
              <X className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
        ))}
        {portfolioUrls.length < MAX_PORTFOLIO && (
          <button
            type="button"
            onClick={() => portfolioInputRef.current?.click()}
            disabled={portfolioUploading}
            className="aspect-square rounded-2xl border-2 border-dashed border-border/60 hover:border-primary/40 flex flex-col items-center justify-center gap-1 text-muted-foreground hover:text-primary active:scale-[0.98] transition-all"
          >
            {portfolioUploading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <ImagePlus className="w-5 h-5" />
                <span className="text-ds-10 font-sans font-medium">Add photo</span>
              </>
            )}
          </button>
        )}
      </div>
      <input
        ref={portfolioInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="hidden"
        onChange={handlePortfolioPick}
        disabled={portfolioUploading}
      />
    </div>
  );
}
