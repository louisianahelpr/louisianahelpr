import { Crown } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface SectionCardProps {
  title: string;
  icon: React.ReactNode;
  hasAccess: boolean;
  isLoading: boolean;
  onUpgrade: () => void;
  children: React.ReactNode;
}

const SectionCard = ({
  title,
  icon,
  hasAccess,
  isLoading,
  onUpgrade,
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

      {/* Upgrade gate — blurs the content when the user is on free tier */}
      {!hasAccess && !isLoading && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center"
          style={{
            background: "hsl(var(--parchment) / 0.85)",
            backdropFilter: "blur(8px)",
            borderRadius: "inherit",
          }}
        >
          <Crown className="w-6 h-6 mb-2" style={{ color: "hsl(var(--bark))" }} />
          <p
            className="font-display italic font-bold text-ds-16 text-center"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            Pro feature
          </p>
          <p
            className="font-serif italic text-ds-12 mb-3 text-center max-w-[200px] mt-1"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            Upgrade to Helpr Pro to unlock earnings insights
          </p>
          <button
            type="button"
            onClick={onUpgrade}
            className="font-sans font-semibold text-ds-13 underline underline-offset-2"
            style={{ color: "hsl(var(--burnt-sienna))" }}
          >
            Upgrade →
          </button>
        </div>
      )}
    </div>
  );
};

export default SectionCard;
