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
  /** Hover glow box-shadow (the lifted state). */
  hoverGlow: string;
  /** Hover icon color. */
  hoverColor: string;
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
    },
    ref,
  ) {
    // Hover styling is driven by these CSS vars + the arbitrary `hover:`
    // utilities below — no onMouseEnter/onMouseLeave JS.
    const style = {
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
    } as CSSProperties;

    return (
      <Button
        ref={ref}
        variant="ghost"
        size="icon"
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
        onClick={onClick}
        className={
          "group glass-press rounded-ds-md h-11 w-11 sm:h-12 sm:w-12 shrink-0 " +
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
