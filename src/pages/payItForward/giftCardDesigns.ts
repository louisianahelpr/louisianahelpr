/**
 * Gift-card occasions and designs.
 *
 * The form used to be three fields — email, amount, note — which made a gift
 * feel like a bank transfer. Occasions give it a reason, and the design gives
 * the recipient something to actually open.
 *
 * ── Why CSS gradients rather than illustrations ────────────────────────
 * Uber ships painted artwork per card. Commissioned illustration isn't
 * available here, and stock art would fight a brand built on Bodoni, parchment
 * and sienna. Gradients composed from the existing palette stay on-brand at
 * any size, weigh nothing, need no CDN (the app is offline-capable and its CSP
 * blocks external hosts), and render identically on the card, in the claim
 * email preview, and in the recipient's wallet.
 *
 * ── No gold ────────────────────────────────────────────────────────────
 * Antique gold is reserved for prestige a user EARNED (P1). A gift card is
 * celebratory, but it is bought, not earned — using gold here would blur the
 * one signal the palette works hardest to keep meaningful.
 *
 * `id` values are persisted on pif_credits.design_id, so they are a stable
 * contract: rename a label freely, never an id.
 */

export interface GiftCardDesign {
  id: string;
  /** Short human name, shown under the swatch. */
  label: string;
  /** CSS background — a gradient composed from brand tokens. */
  background: string;
  /** Ink used for the card's own text where it sits on `background`. */
  ink: string;
  /** A single motif glyph. Emoji rather than an icon set: it renders at any
   *  size, needs no import, and survives being embedded in an email. */
  motif: string;
}

export interface GiftOccasion {
  id: string;
  label: string;
  /** Pre-fills the note placeholder so the writer isn't staring at a blank box. */
  notePlaceholder: string;
  designs: GiftCardDesign[];
}

export const GIFT_OCCASIONS: GiftOccasion[] = [
  {
    id: "thank_you",
    label: "Thank you",
    notePlaceholder: "Thank you — this one's on me.",
    designs: [
      {
        id: "thanks_parchment",
        label: "Parchment",
        background:
          "radial-gradient(circle at 18% 12%, hsl(var(--parchment)) 0%, transparent 55%), linear-gradient(135deg, hsl(var(--ivory-sand)) 0%, hsl(var(--burnt-sienna) / 0.30) 100%)",
        ink: "hsl(var(--ink-deep))",
        motif: "🙏",
      },
      {
        id: "thanks_bayou",
        label: "Bayou",
        background:
          "linear-gradient(150deg, hsl(var(--bark)) 0%, hsl(var(--olivewood)) 55%, hsl(var(--bark) / 0.75) 100%)",
        ink: "hsl(var(--parchment))",
        motif: "🌾",
      },
    ],
  },
  {
    id: "birthday",
    label: "Birthday",
    notePlaceholder: "Happy birthday! Spend it on something you'd rather not do yourself.",
    designs: [
      {
        id: "bday_king_cake",
        label: "King cake",
        background:
          "linear-gradient(135deg, hsl(var(--burnt-sienna)) 0%, hsl(var(--burnt-sienna) / 0.55) 45%, hsl(var(--ivory-sand)) 100%)",
        ink: "hsl(var(--parchment))",
        motif: "🎂",
      },
      {
        id: "bday_confetti",
        label: "Confetti",
        background:
          "radial-gradient(circle at 78% 18%, hsl(var(--burnt-sienna) / 0.55) 0%, transparent 45%), radial-gradient(circle at 22% 78%, hsl(var(--bark) / 0.45) 0%, transparent 45%), hsl(var(--parchment))",
        ink: "hsl(var(--ink-deep))",
        motif: "🎉",
      },
    ],
  },
  {
    id: "congratulations",
    label: "Congratulations",
    notePlaceholder: "Congratulations! Let someone else handle the heavy lifting.",
    designs: [
      {
        id: "congrats_dusk",
        label: "Dusk",
        background:
          "linear-gradient(160deg, hsl(var(--ink-deep)) 0%, hsl(var(--olivewood)) 60%, hsl(var(--burnt-sienna) / 0.65) 100%)",
        ink: "hsl(var(--parchment))",
        motif: "🥂",
      },
      {
        id: "congrats_sunrise",
        label: "Sunrise",
        background:
          "linear-gradient(180deg, hsl(var(--burnt-sienna) / 0.75) 0%, hsl(var(--ivory-sand)) 65%, hsl(var(--parchment)) 100%)",
        ink: "hsl(var(--ink-deep))",
        motif: "✨",
      },
    ],
  },
  {
    id: "new_home",
    label: "New home",
    notePlaceholder: "Congrats on the new place — for whatever needs doing.",
    designs: [
      {
        id: "home_porch",
        label: "Porch",
        background:
          "linear-gradient(145deg, hsl(var(--olivewood)) 0%, hsl(var(--bark) / 0.85) 50%, hsl(var(--ivory-sand)) 100%)",
        ink: "hsl(var(--parchment))",
        motif: "🏡",
      },
    ],
  },
  {
    id: "thinking_of_you",
    label: "Thinking of you",
    notePlaceholder: "Thinking of you — let me take something off your plate.",
    designs: [
      {
        id: "thinking_quiet",
        label: "Quiet",
        background:
          "linear-gradient(135deg, hsl(var(--ivory-sand)) 0%, hsl(var(--olivewood) / 0.35) 100%)",
        ink: "hsl(var(--ink-deep))",
        motif: "🤍",
      },
      {
        id: "thinking_storm",
        label: "After the storm",
        background:
          "linear-gradient(165deg, hsl(var(--olivewood)) 0%, hsl(var(--ink-deep) / 0.85) 70%, hsl(var(--bark) / 0.6) 100%)",
        ink: "hsl(var(--parchment))",
        motif: "🌤️",
      },
    ],
  },
  {
    id: "just_because",
    label: "Just because",
    notePlaceholder: "No reason. Use it whenever.",
    designs: [
      {
        id: "just_sienna",
        label: "Sienna",
        background:
          "linear-gradient(135deg, hsl(var(--burnt-sienna)) 0%, hsl(var(--olivewood)) 100%)",
        ink: "hsl(var(--parchment))",
        motif: "💌",
      },
    ],
  },
];

/** Flat design lookup — the persisted `design_id` resolves through this. */
const DESIGN_BY_ID: Record<string, GiftCardDesign> = Object.fromEntries(
  GIFT_OCCASIONS.flatMap((o) => o.designs.map((d) => [d.id, d])),
);

export const DEFAULT_OCCASION = GIFT_OCCASIONS[0];
export const DEFAULT_DESIGN = DEFAULT_OCCASION.designs[0];
