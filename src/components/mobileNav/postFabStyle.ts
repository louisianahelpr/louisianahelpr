import type { CSSProperties } from "react";

/**
 * The dock's Post button surface (moved out of MobileNav.tsx for the under-18
 * grey-out's lines, Q1586(c)).
 *
 * NEARLY FLAT (owner, 2026-10-18, option 3B): solid olive, one small soft
 * shadow. No lit-from-top orb, no inner highlight, no glow ring: the same
 * surface every primary button wears (`.btn-grad-primary` in src/index.css).
 */
export const POST_FAB_STYLE: CSSProperties = {
  backgroundColor: "hsl(var(--bark))",
  color: "hsl(var(--parchment))",
  border: "1px solid transparent",
  boxShadow: "0 2px 6px -2px hsl(var(--olivewood) / 0.30)",
};
