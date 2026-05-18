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
  /** Small uppercase serif eyebrow above the title. Optional. */
  eyebrow?: string;
  /** Bold display-italic headline. Optional. */
  title?: string;
  /** Supporting sentence under the title. */
  body: string;
  /** Optional CTA (button / link) rendered below the copy. */
  action?: ReactNode;
  /** Card treatment — see EmptyStateVariant. Defaults to `dock`. */
  variant?: EmptyStateVariant;
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
  eyebrow,
  title,
  body,
  action,
  variant = "dock",
}: EmptyStateProps) {
  const isDock = variant === "dock";
  const cardStyle: CSSProperties = isDock
    ? {
        borderBottomLeftRadius: 0,
        borderBottomRightRadius: 0,
        borderBottom: "none",
        boxShadow:
          "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
          "-1px 0 2px hsl(var(--olivewood) / 0.06), " +
          "1px 0 2px hsl(var(--olivewood) / 0.06), " +
          "0 -1px 2px hsl(var(--olivewood) / 0.06)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 96px + 1.5rem)",
      }
    : {};

  return (
    <div
      className={
        isDock
          ? "flex-1 liquid-glass flex flex-col items-center text-center justify-center gap-4 px-6 py-8 rounded-t-2xl"
          : "flex-1 liquid-glass flex flex-col items-center text-center justify-center gap-4 px-6 py-12 rounded-2xl"
      }
      style={cardStyle}
    >
      <div
        className="w-20 h-20 rounded-full flex items-center justify-center"
        style={{
          backgroundColor: "hsla(0, 0%, 100%, 0.55)",
          backdropFilter: "blur(16px) saturate(150%)",
          WebkitBackdropFilter: "blur(16px) saturate(150%)",
          border: "1px solid hsl(var(--olivewood) / 0.10)",
          boxShadow:
            "inset 0 1px 1px 0 rgba(255, 255, 255, 0.65), " +
            "0 1px 2px hsl(var(--olivewood) / 0.05), " +
            "0 8px 22px -6px hsl(var(--olivewood) / 0.12)",
        }}
      >
        <Icon className="w-8 h-8" style={{ color: "hsl(var(--bark))" }} strokeWidth={1.5} />
      </div>
      <div className="space-y-1.5">
        {eyebrow && <span className="text-display-eyebrow">{eyebrow}</span>}
        {title && (
          <p
            className="font-display italic font-bold leading-tight"
            style={{
              fontSize: "clamp(1.1rem, 1.5vw + 0.4rem, 1.4rem)",
              color: "hsl(var(--ink-deep))",
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </p>
        )}
        <p
          className="font-serif italic text-ds-13 leading-relaxed max-w-sm mx-auto"
          style={{ color: "hsl(var(--olivewood) / 0.7)" }}
        >
          {body}
        </p>
      </div>
      {action}
    </div>
  );
}
