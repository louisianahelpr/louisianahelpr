import { Crown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface SectionCardProps {
  title: string;
  icon: React.ReactNode;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
  /** Section-specific preview line shown in the locked/upsell state.
   *  Without this every locked card showed the same "Upgrade to Helpr
   *  Pro to unlock earnings insights" text, so 7 cards on a free-tier
   *  /analytics page read as a broken template loop. Passing a distinct
   *  preview per section (e.g. "See which categories earned you the
   *  most" for TopCategories) makes each locked card differentiated. */
  lockedPreview?: string;
  children: React.ReactNode;
}

const SectionCard = ({
  title,
  icon,
  hasAccess,
  isLoading,
  onUpgrade,
  lockedPreview,
  children,
}: SectionCardProps) => {
  return (
    <div
      className="rounded-2xl liquid-glass p-5 relative overflow-hidden"
      style={{
        boxShadow:
          "inset 0 1px 1px 0 rgba(255,255,255,0.4), " +
          "0 1px 2px hsl(var(--olivewood) / 0.06), " +
          "0 12px 28px -10px hsl(var(--olivewood) / 0.14)",
      }}
    >
      <div className="flex items-center gap-2 mb-4">
        <span style={{ color: "hsl(var(--burnt-sienna))" }}>{icon}</span>
        <h2
          className="font-serif italic uppercase text-ds-9"
          style={{ color: "hsl(var(--burnt-sienna))", letterSpacing: "0.18em" }}
        >
          {title}
        </h2>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4 rounded" />
          <Skeleton className="h-4 w-1/2 rounded" />
        </div>
      ) : (
        children
      )}

      {/* Upgrade gate — blurs the content when the user is on free tier.
          Uses the section's own title + per-section preview so each
          locked card reads as distinct (not seven identical upsells). */}
      {!hasAccess && !isLoading && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center px-4"
          style={{
            background: "hsl(var(--parchment) / 0.85)",
            backdropFilter: "blur(8px)",
            borderRadius: "inherit",
          }}
        >
          <span
            className="inline-flex items-center gap-1 mb-2 font-sans font-semibold uppercase text-ds-10 tracking-[0.16em]"
            style={{ color: "hsl(var(--bark) / 0.8)" }}
          >
            <Crown className="w-3 h-3" strokeWidth={2} />
            Pro
          </span>
          <p
            className="font-display italic font-bold text-ds-16 text-center"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {title}
          </p>
          <p
            className="font-serif italic text-ds-12 mb-3 text-center max-w-[220px] mt-1"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {lockedPreview ?? "Available with Helpr Pro"}
          </p>
          <button
            type="button"
            onClick={onUpgrade}
            className="font-sans font-semibold text-ds-13 underline underline-offset-2"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Unlock →
          </button>
        </div>
      )}
    </div>
  );
};

export default SectionCard;
