import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Visual variant:
 * - `dock` (default): top corners rounded, bottom flat and shadow-cropped
 *   so the card bleeds beneath the floating dock with no hard edge. Used
 *   on full-surface empty states (Messages, My Posts / My Jobs, Browse).
 * - `inline`: a self-contained frosted card rounded on all four corners,
 *   sitting inline within a scrolling page — no dock bleed.
 */
type EmptyStateVariant = "dock" | "inline";

interface EmptyStateProps {
  /** Lucide icon rendered inside the frosted circle. */
  icon: LucideIcon;
  /**
   * Optional branded line-art illustration. When provided, it renders in
   * place of the frosted-circle icon — used to give high-traffic empty
   * states a warmer, hand-drawn feel.
   */
  illustration?: ReactNode;
  /** Small uppercase serif eyebrow above the title. Optional. */
  eyebrow?: string;
  /** Bold display-italic headline. Optional. */
  title?: string;
  /** Supporting sentence under the title. */
  body: string;
  /** Optional CTA (button / link) rendered below the copy. */
  action?: ReactNode;
  /**
   * Fine print rendered INSIDE the card, below the CTA — for the note a page
   * would otherwise strand on the bare page background under the card (which
   * is what /str-settings did with its sync-cadence sentence, and no other
   * Profile sub-page does).
   *
   * Rendered with no wrapper on purpose: the caller owns its element, so a
   * node that hides itself at a breakpoint (`lg:hidden`) takes itself out of
   * the flex flow entirely and leaves no gap behind.
   */
  footnote?: ReactNode;
  /** Card treatment — see EmptyStateVariant. Defaults to `dock`. */
  variant?: EmptyStateVariant;
  /**
   * Surface override, merged last over the card's own background / border /
   * shadow. Only for the handful of pages that deliberately run a different
   * card material than `.liquid-glass` — /str-settings shares
   * SubscriptionPage's premium-surface treatment so the two paid-feature
   * screens read as one product tier, and a white glass tile in the middle
   * of it would break that. Omit everywhere else: one material per surface
   * is the point of this component.
   */
  surfaceStyle?: CSSProperties;
}

/**
 * EmptyState — the shared "nothing here yet" card used across the
 * Messages, My Posts / My Jobs, and Browse Tasks surfaces.
 *
 * The `dock` variant renders the liquid-glass card with top corners
 * rounded, bottom flat and shadow-cropped so it bleeds beneath the dock
 * with no hard edge. The `inline` variant is a fully rounded card for
 * empty states that sit inline within a scrolling page.
 *
 * The caller supplies the flex wrapper that sizes it — the card uses
 * flex-1 to fill that wrapper.
 */
export function EmptyState({
  icon: Icon,
  illustration,
  eyebrow,
  title,
  body,
  action,
  footnote,
  variant = "dock",
  surfaceStyle,
}: EmptyStateProps) {
  const isDock = variant === "dock";

  const variantStyle: CSSProperties = isDock
    ? {
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderBottom: "none",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.45), " +
          "-1px 0 2px hsl(var(--olivewood) / 0.05), " +
          "1px 0 2px hsl(var(--olivewood) / 0.05), " +
          "0 -1px 3px hsl(var(--olivewood) / 0.05)",
        paddingBottom: "calc(var(--safe-area-bottom, 0px) + 96px + 2rem)",
      }
    : {};

  const cardStyle: CSSProperties = surfaceStyle
    ? { ...variantStyle, ...surfaceStyle }
    : variantStyle;

  // Frosted icon bubble — a deeper bark-tinted base gives the icon more
  // visual anchor while the inner cream highlight keeps it from looking
  // heavy. The subtle outer halo connects it to the liquid-glass surface.
  const iconBubbleStyle: CSSProperties = {
    backgroundColor: "hsl(var(--parchment) / 0.72)",
    backdropFilter: "blur(20px) saturate(160%)",
    WebkitBackdropFilter: "blur(20px) saturate(160%)",
    border: "1px solid hsl(var(--olivewood) / 0.09)",
    boxShadow:
      "inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.75), " +
      "inset 0 -1px 1px 0 hsl(var(--bark) / 0.06), " +
      "0 1px 3px hsl(var(--olivewood) / 0.06), " +
      "0 6px 18px -4px hsl(var(--olivewood) / 0.10)",
  };

  return (
    <div
      // `min-w-0 max-w-full` is load-bearing, not defensive dressing. A flex
      // item defaults to `min-width: auto`, which refuses to shrink below the
      // intrinsic width of its content — so a long unbreakable label pushed
      // this panel WIDER than its 320px container instead of wrapping, and the
      // whole page overflowed horizontally.
      //
      // It reproduced only on CI's runner, whose font metrics differ from a
      // Mac's, which is why a local repro kept coming back clean while
      // `device-pass-measure /dashboard @ 320-light` failed every run.
      className={
        isDock
          ? "flex-1 min-w-0 max-w-full liquid-glass flex flex-col items-center text-center justify-center gap-5 px-5 sm:px-8 py-10 rounded-t-2xl"
          : "flex-1 min-w-0 max-w-full liquid-glass flex flex-col items-center text-center justify-center gap-5 px-5 sm:px-8 py-14 rounded-2xl"
      }
      style={cardStyle}
    >
      {illustration ? (
        <div
          className="flex items-center justify-center opacity-90"
          aria-hidden="true"
        >
          {illustration}
        </div>
      ) : (
        /* Icon bubble: 88px for presence without weight; squircle-style
           rounding would need inline border-radius so keep it circular. */
        <div
          className="w-[88px] h-[88px] rounded-full flex items-center justify-center"
          style={iconBubbleStyle}
          aria-hidden="true"
        >
          <Icon
            className="w-9 h-9"
            style={{ color: "hsl(var(--bark))" }}
            strokeWidth={1.4}
          />
        </div>
      )}

      {/* w-full + min-w-0 lets the text column shrink to the card's
          available width at 320w so long titles wrap instead of
          forcing the column wider than the viewport. Without these,
          flex-col + items-center keeps children at their natural
          inline width and they overflow off the right edge. */}
      <div className="w-full min-w-0 space-y-2">
        {eyebrow && (
          <span className="text-display-eyebrow tracking-widest">
            {eyebrow}
          </span>
        )}
        {title && (
          <p
            className="font-display italic font-bold leading-tight break-words"
            style={{
              fontSize: "clamp(1.15rem, 1.5vw + 0.45rem, 1.45rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.025em",
            }}
          >
            {title}
          </p>
        )}
        <p
          className="font-serif italic text-ds-13 leading-relaxed max-w-[26rem] mx-auto break-words"
          style={{ color: "hsl(var(--olivewood) / 0.8)" }}
        >
          {body}
        </p>
      </div>

      {action && (
        /* Breathing room between body copy and the CTA so the button
           doesn't feel glued to the paragraph. */
        <div className="mt-1">{action}</div>
      )}

      {footnote}
    </div>
  );
}
