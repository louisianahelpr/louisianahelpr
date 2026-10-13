import type { CSSProperties } from "react";

/**
 * The dock's Post button surface, moved out of MobileNav.tsx unchanged (it
 * paid for the under-18 grey-out's lines there, Q1586(c)).
 *
 * Lit-from-top orb — a radial highlight in the upper-left fading to a deeper
 * olive at the base gives the puck real sphere-like dimension instead of a
 * flat disc.
 */
export const POST_FAB_STYLE: CSSProperties = {
  background:
    "radial-gradient(125% 125% at 32% 22%, hsl(var(--bark-light)) 0%, hsl(var(--bark)) 46%, hsl(var(--bark-deep)) 100%)",
  color: "hsl(var(--parchment))",
  border: "1px solid hsl(var(--bark-border))",
  boxShadow:
    "inset 0 1.5px 1px 0 rgba(255, 255, 255, 0.28), " +
    "inset 0 -2px 3px 0 hsl(66 28% 14% / 0.45), " +
    "0 1px 2px hsl(70 20% 18% / 0.22), " +
    "0 8px 18px -6px hsl(var(--bark) / 0.55), " +
    "0 18px 36px -12px hsl(var(--bark) / 0.4), " +
    "0 0 0 6px hsl(var(--bark) / 0.06), " +
    "0 0 24px 4px hsl(var(--bark) / 0.22)",
};
