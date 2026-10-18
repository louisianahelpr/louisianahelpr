import type { CSSProperties } from "react";

/**
 * The app's two-step page material: a softer title card sitting on a crisper
 * content panel.
 *
 * These values used to live inside {@link PageScaffold}, which made them
 * available only to the fixed-shell pages that render through it (Dashboard,
 * Messages, My Jobs, My Posts, guest dashboard). The document-scroll pages
 * that want the SAME treatment — Family & care, Home History — cannot use
 * PageScaffold, because PageScaffold is a wrapper over AppShell and brings a
 * 100dvh viewport lock with it, which is wrong for an unbounded list.
 *
 * So the material is extracted here and the layout is not: PageScaffold still
 * owns the fixed-shell arrangement and paints from this one definition. (A
 * DocumentPageCards counterpart owned the document-scroll arrangement until it
 * was deleted unused on 2026-08-25.) Copying the numbers into a second file
 * instead would have guaranteed the two drifted the first time anyone touched
 * an opacity.
 */

export const TITLE_CARD_CLASS =
  "liquid-glass shrink-0 px-5 py-4 lg:px-6 lg:py-5 relative overflow-hidden";

export const TITLE_CARD_STYLE: CSSProperties = {
  // Intentional two-step material hierarchy: the title card sits a touch
  // more translucent (0.85) than the crisper panel below (0.97), so the
  // header reads as the softer "lid" over a solid content panel rather
  // than the two stacking into one flat slab. Same hue — only the opacity
  // steps — so they stay obviously the same material. Very faint copper /
  // verdigris corner glows keep the card from reading as a flat block.
  backgroundColor: "var(--glass-bg-title)",
  // FLAT (Warm Modern, owner 2026-10-17, C2 mock-ups): no tinted gradients,
  // no inset top highlight, one soft warm shadow in light and none in dark
  // (dark --olivewood is near-white, so the old olivewood shadows painted a
  // pale GLOW around every card on the dark page). --card-flat-shadow is set
  // per theme in index.css.
  boxShadow: "var(--card-flat-shadow)",
};

export type PanelElevation = "raised" | "flat";

// Flat like the title card: the raised panel takes the one warm shadow, the
// flat panel none (its hairline border is the edge).
const PANEL_SHADOW: Record<PanelElevation, string> = {
  raised: "var(--card-flat-shadow)",
  flat: "none",
};

/**
 * The panel surface. Bottom corners flat and the bottom border dropped so the
 * panel bleeds off the end of the page instead of ending in a hard edge under
 * the floating dock — the same reason PageScaffold's panel does it.
 */
export const panelSurfaceStyle = (
  elevation: PanelElevation = "raised",
): CSSProperties => ({
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  borderBottom: "none",
  // Crisp near-opaque white surface (0.97) — the solid base of the
  // two-step hierarchy, one step crisper than the softer title card
  // (0.85) above. `.liquid-glass`'s 42%-white wash reads as muted beige
  // over the warm page gradient, so the panel blended into the canvas; a
  // bright near-opaque panel pops off the page as the content surface.
  backgroundColor: "var(--glass-bg-crisp)",
  boxShadow: PANEL_SHADOW[elevation],
});
