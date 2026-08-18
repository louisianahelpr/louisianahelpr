import { Crown, Lock } from "lucide-react";
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

/**
 * SectionCard — one analytics panel, with the Pro gate.
 *
 * ── The locked state is a ROW, not a card ─────────────────────────────────
 *
 * It used to be the full card: the real content rendered underneath and an
 * absolutely-positioned overlay blurred it and stamped a crown, the section
 * title again, a preview line and an "Unlock →" over the top. That meant a
 * locked panel cost the same ~380px as an unlocked one while carrying none of
 * its information, and a free-tier /analytics page stacked five of them — about
 * 2,000px of the same card with different words, five identical calls to
 * action, and the shape of an ad break. Owner: "needs to be better organized".
 *
 * The information-design problem was that every locked feature was given equal,
 * maximal weight, so nothing was emphasised and the whole page was pressure.
 * A locked panel now states what it is in one scannable line and gets out of
 * the way; the page carries ONE upgrade action above the group (see
 * HelperAnalytics), which is both less pressure and — as it happens — the
 * arrangement that converts. Whatever a free user CAN see now leads the page.
 *
 * The upgrade path is NOT removed and is NOT harder to find: the whole row is
 * a button that calls the same `onUpgrade`, so every locked panel is still a
 * one-tap route to the plan picker, and the row keeps a ≥44px target.
 *
 * The blurred-content treatment is gone with it. It never previewed anything —
 * the underlying content is a chart of data the free user does not have, so it
 * was blurring a mostly-empty panel — and rendering it meant paying for the
 * chart subtree on a page where it could not be read.
 */
const SectionCard = ({
  title,
  icon,
  hasAccess,
  isLoading,
  onUpgrade,
  lockedPreview,
  children,
}: SectionCardProps) => {
  if (!hasAccess && !isLoading) {
    return (
      <button
        type="button"
        onClick={onUpgrade}
        aria-label={`${title} — included with Helpr Pro. Upgrade to unlock.`}
        className="w-full text-left rounded-2xl liquid-glass px-4 py-3 flex items-center gap-3 min-h-[44px] glass-press"
        style={{
          boxShadow:
            "inset 0 1px 1px 0 rgba(255,255,255,0.4), " +
            "0 1px 2px hsl(var(--olivewood) / 0.06)",
        }}
      >
        <span className="shrink-0" style={{ color: "hsl(var(--olivewood) / 0.55)" }} aria-hidden>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block font-sans font-semibold text-ds-13 truncate"
            style={{ color: "hsl(var(--ink-deep))" }}
          >
            {title}
          </span>
          <span
            className="block font-serif italic text-ds-11 truncate"
            style={{ color: "hsl(var(--olivewood) / 0.8)" }}
          >
            {lockedPreview ?? "Available with Helpr Pro"}
          </span>
        </span>
        {/* The lock is the affordance; "Pro" is the reason. One quiet pair at
            the end of the row replaces the crown + repeated title + "Unlock →"
            stack that used to fill the whole card. */}
        <span
          className="shrink-0 inline-flex items-center gap-1 font-sans font-semibold uppercase text-ds-10 tracking-[0.16em]"
          // Full opacity: the 20% alpha lightened bark to #7c8267 = 3.63:1
          // at 10px, under WCAG AA. Same alpha-lightening pattern as the
          // admin KPI trend and the credential labels.
          style={{ color: "hsl(var(--bark))" }}
        >
          <Lock className="w-3 h-3" strokeWidth={2} aria-hidden />
          Pro
        </span>
      </button>
    );
  }

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
    </div>
  );
};

/**
 * The page's single upgrade action, shown once above the locked group.
 *
 * Five "Unlock →" links in a column is the shape of an ad break; one clear
 * action at the head of the locked set says the same thing once. Lives here
 * next to the locked row it introduces so the two stay in step.
 */
export const ProUpsellHeader = ({ onUpgrade, count }: { onUpgrade: () => void; count: number }) => (
  <div
    className="rounded-2xl liquid-glass px-4 py-3.5 flex items-center gap-3"
    style={{ boxShadow: "inset 0 1px 1px 0 rgba(255,255,255,0.4), 0 1px 2px hsl(var(--olivewood) / 0.06)" }}
  >
    <span className="shrink-0" style={{ color: "hsl(var(--bark))" }} aria-hidden>
      <Crown className="w-4 h-4" strokeWidth={2} />
    </span>
    <p className="min-w-0 flex-1 text-ds-12" style={{ color: "hsl(var(--ink-deep))" }}>
      <span className="font-sans font-semibold">
        {count} more {count === 1 ? "insight" : "insights"} with Helpr Pro
      </span>
      <span className="block font-serif italic text-ds-11" style={{ color: "hsl(var(--olivewood) / 0.8)" }}>
        Everything below unlocks together.
      </span>
    </p>
    <button
      type="button"
      onClick={onUpgrade}
      className="shrink-0 rounded-full px-4 min-h-[44px] font-sans font-semibold text-ds-13 glass-press"
      style={{
        background: "hsl(var(--bark))",
        color: "hsl(var(--parchment))",
        boxShadow: "var(--elev-bark-flat)",
      }}
    >
      Upgrade
    </button>
  </div>
);

export default SectionCard;
