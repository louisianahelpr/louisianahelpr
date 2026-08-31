import { forwardRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * IconActionButton — the shared glass icon button used in JobDetailDialog's
 * footer action row (Flag · Save · Message). It replaces ~90 lines of
 * duplicated inline `onMouseEnter`/`onMouseLeave` hover JS that mutated
 * `e.currentTarget.style` on three near-identical buttons.
 *
 * Hover is desktop-only on this Capacitor app, so it lives entirely in CSS
 * via the `group` + Tailwind arbitrary-`hover:` pattern (no JS handlers on
 * the real device). The per-button accent (Flag = burnt-sienna, Save =
 * primary, Message = bark) is threaded through two CSS custom properties:
 *   --ia-glow  — the hover box-shadow string
 *   --ia-color — the hover icon color
 * so a single component covers all three accents while preserving the exact
 * sizing (h-11/h-12, rounded-ds-md), glass background, and aria-labels.
 *
 * The `pressed` variant (used by Save's `isSaved` state) tints the resting
 * background/border/color with the accent, matching the old inline styles.
 */
export interface IconActionButtonProps {
  /** The lucide icon element, already styled with its micro-animation classes. */
  icon: ReactNode;
  /** Accessible label — required (icon-only button). */
  ariaLabel: string;
  onClick: () => void;
  /** Hover glow box-shadow (the lifted state). Ignored when `bare`. */
  hoverGlow?: string;
  /** Hover icon color. Ignored when `bare`. */
  hoverColor?: string;
  /**
   * Strip the glass plate — no fill, border, or resting shadow, just the
   * icon in a 44px tap target. For chrome positions where the button sits
   * beside the dialog's own X, which is bare for the same reason: a row of
   * filled tiles up there reads as content rather than window furniture.
   */
  bare?: boolean;
  /** Pressed/active state (Save when `isSaved`) — tints the resting styles. */
  pressed?: boolean;
  /** Resting background when pressed (e.g. Save's primary tint). */
  pressedBackground?: string;
  /** Resting border when pressed. */
  pressedBorder?: string;
  /** Resting icon color when pressed. */
  pressedColor?: string;
  /** Reflects toggle state to assistive tech (Save). */
  ariaPressed?: boolean;
  /**
   * Shrinks the tap target below the global 44px HIG floor (owner,
   * 2026-08-30, via a pop-up question: icons "smaller... because it makes
   * a large gap above title" — the corner cluster's height is what forces
   * the whole title row down). Only for `bare`; needs an inline
   * min-height/min-width override since the global
   * `button { min-height: 44px }` rule otherwise wins over any Tailwind
   * size utility.
   */
  compact?: boolean;
}

const RESTING_SHADOW =
  "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), 0 1px 2px hsl(var(--olivewood) / 0.04)";

export const IconActionButton = forwardRef<HTMLButtonElement, IconActionButtonProps>(
  function IconActionButton(
    {
      icon,
      ariaLabel,
      onClick,
      hoverGlow,
      hoverColor,
      pressed = false,
      pressedBackground,
      pressedBorder,
      pressedColor,
      ariaPressed,
      bare = false,
      compact = false,
    },
    ref,
  ) {
    // Hover styling is driven by these CSS vars + the arbitrary `hover:`
    // utilities below — no onMouseEnter/onMouseLeave JS.
    const style = bare
      ? ({
          color: pressed ? pressedColor : "hsl(var(--muted-foreground))",
          transition: "color 0.2s ease",
          // Below the global `button { min-height/min-width: 44px }` floor —
          // inline styles are the only thing that beats it (a Tailwind size
          // utility loses to that plain-CSS rule).
          ...(compact ? { minHeight: "32px", minWidth: "32px" } : {}),
        } as CSSProperties)
      : ({
          backgroundColor: pressed ? pressedBackground : "var(--glass-bg-soft)",
          backdropFilter: "blur(20px) saturate(150%)",
          WebkitBackdropFilter: "blur(20px) saturate(150%)",
          border: pressed ? pressedBorder : "0.5px solid var(--glass-border)",
          color: pressed ? pressedColor : "hsl(var(--olivewood) / 0.8)",
          boxShadow: RESTING_SHADOW,
          transition: "all 0.2s ease, box-shadow 0.3s ease",
          // Custom props consumed by the hover: utilities in className.
          "--ia-glow": hoverGlow,
          "--ia-color": hoverColor,
        } as CSSProperties);

    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        onClick={onClick}
        className={
          bare
            ? `group rounded-md ${compact ? "h-8 w-8" : "h-11 w-11"} shrink-0 btn-press hover:text-foreground hover:bg-transparent active:bg-transparent transition-colors`
            : "group glass-press rounded-ds-md h-11 w-11 sm:h-12 sm:w-12 shrink-0 " +
              "transition-all duration-200 hover:scale-105 active:scale-95 " +
              // CSS-driven hover (desktop only): lift the glow + recolor the icon
              // via the per-instance custom properties. Pressed buttons keep
              // their accent resting color, so only the glow lifts on hover.
              "hover:[box-shadow:var(--ia-glow)] " +
              (pressed ? "" : "hover:[color:var(--ia-color)]")
        }
        style={style}
      >
        {icon}
      </Button>
    );
  },
);
