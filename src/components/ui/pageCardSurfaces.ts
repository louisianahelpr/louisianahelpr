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
  backgroundImage:
    "radial-gradient(70% 90% at 100% 0%, hsl(var(--burnt-sienna) / 0.05) 0%, transparent 55%), " +
    "radial-gradient(60% 80% at 0% 100%, hsl(165 18% 80% / 0.12) 0%, transparent 60%)",
  boxShadow:
    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
    "inset 0 -1px 1px 0 rgba(0, 0, 0, 0.04), " +
    "0 1px 2px hsl(var(--olivewood) / 0.05), " +
    "0 8px 18px -6px hsl(var(--olivewood) / 0.1), " +
    "0 18px 32px -10px hsl(var(--olivewood) / 0.12)",
};

export type PanelElevation = "raised" | "flat";

export const PANEL_SHADOW: Record<PanelElevation, string> = {
  raised:
    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
    "0 1px 2px hsl(var(--olivewood) / 0.06), " +
    "0 14px 30px -8px hsl(var(--olivewood) / 0.14), " +
    "0 36px 64px -16px hsl(var(--olivewood) / 0.18)",
  flat:
    "inset 0 1px 1px 0 rgba(255, 255, 255, 0.4), " +
    "-1px 0 2px hsl(var(--olivewood) / 0.06), " +
    "1px 0 2px hsl(var(--olivewood) / 0.06), " +
    "0 -1px 2px hsl(var(--olivewood) / 0.06)",
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
