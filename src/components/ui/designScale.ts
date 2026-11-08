/**
 * The app's design roles in ONE place (design audit 11-08, B §4 [shared]; owner picks 11-08). Declutter adopts them
 * first, and Jobs / Dashboard / Shops / Homes reuse the same names, so a screen asks for a ROLE ("card price",
 * "meta line") and never picks a size by hand.
 *
 * Type: the five sizes are the app's existing five (Q2027, owner D10: 11 / 13 / 16 / 20 / 28, held at exactly five by
 * src/test/typeAndIconScaleRatchet.test.ts). The audit's roles map onto them one to one; no sixth size is added.
 *   xs 11  meta: condition · distance, time left, captions, photo tags
 *   sm 13  body, card titles, list rows
 *   md 16  card price, buttons, sheet titles
 *   lg 20  page and section titles
 *   xl 28  the item price on the item page only
 * Weights: 400 body, 600 labels, 700 prices and titles.
 *
 * Spacing: 4-pt steps (4, 8, 12, 16, 24, 32 = Tailwind 1, 2, 3, 4, 6, 8). Page gutter 16; gap between cards 12; inside
 * a card 16 padding, 8 between lines, 12 before the button row; between sections 24.
 *
 * Colour roles (unchanged palette, Montserrat everywhere on app screens):
 *   ink    the price a buyer pays (incl. fee) and titles
 *   muted  meta and the base price
 *   deal   burnt sienna: Free, a price drop, "Bundle deal", unread dot. Never every price.
 *   tint   create tint: status pills and selected options
 */
export const TYPE = {
  xs: "text-ds-11",
  sm: "text-ds-13",
  md: "text-ds-16",
  lg: "text-ds-20",
  xl: "text-ds-28",
} as const;

export const SPACE = {
  gutter: "px-4",
  cardGap: "gap-3",
  cardPad: "p-4",
  lineGap: "space-y-2",
  beforeButtons: "mt-3",
  sectionGap: "space-y-6",
} as const;

/** The price a buyer pays (incl. fee): the loud number, in ink. */
export const PRICE_PAID = "font-bold tabular-nums text-foreground";
/** The base price beside it: small and grey (owner 11-08 pick 2, "one price story"). */
export const PRICE_BASE = "font-medium tabular-nums text-muted-foreground";
/** Free, a price drop, a deal: the one place burnt sienna is used for money. */
export const PRICE_DEAL = "font-bold tabular-nums text-[hsl(var(--burnt-sienna))]";
