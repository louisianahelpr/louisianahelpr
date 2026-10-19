import type { CSSProperties } from "react";

/**
 * The ONE sheet-title look: SheetHero's title, and any sheet-like panel that
 * cannot use SheetHero because it is not a Radix Sheet (FilterSheet's anchored
 * Popover band, Q237). Kept here, not inline, so the two cannot drift: the band
 * was `font-sans text-ds-17 font-bold` while every other titled sheet wore the
 * display title below. Upright Montserrat (index.css T1); no `italic` here, the
 * rendered guard is e2e/happy-path/titles-upright.spec.ts.
 */
export const SHEET_HERO_TITLE_CLASS = "font-display font-bold leading-tight [overflow-wrap:anywhere]";

export const SHEET_HERO_TITLE_STYLE: CSSProperties = {
  fontSize: "clamp(1.2rem, 1.6vw + 0.4rem, 1.45rem)",
  color: "hsl(var(--ink-deep))",
  letterSpacing: "-0.02em",
};
