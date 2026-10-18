import type { CSSProperties } from "react";

/**
 * The dock's Post button surface, moved out of MobileNav.tsx unchanged (it
 * paid for the under-18 grey-out's lines there, Q1586(c)).
 *
 * Flat brand green (owner, 2026-10-17: design C "Warm Modern", flat
 * buttons): the same fill as .btn-grad-primary in both themes, no orb
 * gradient, no glow.
 */
export const POST_FAB_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--brand))",
  color: "hsl(var(--brand-foreground))",
};
