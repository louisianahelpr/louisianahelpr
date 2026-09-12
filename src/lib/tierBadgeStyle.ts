// How a subscription tier is DRAWN, in one table.
//
// Three surfaces render a tier badge — JobPosterCard (poster tile), the
// applicant/profile chips and IdentityHeader (profile header) —
// and each of them used to carry its own `tier === "elite" ? … : tier ===
// "pro" ? … : tier === "basic" ? …` chain. All three therefore drew NOTHING
// for a Plus member (CC-019): the trust row opened, the badge slot was empty,
// and the only person who could tell was the one paying $15/mo.
//
// The colour rule (owner, via HelperBadges): gold is reserved for Elite, the
// top rung. Pro and Plus share the sienna accent and the Sparkles mark —
// deliberately, because Plus IS "everything in Pro" plus a lower fee, and the
// tier NAME beside the icon is what distinguishes them. Basic stays neutral
// bark so the gold reads as something earned rather than something bought at
// the bottom of the ladder. Every value here is an existing design token; no
// new colour was invented to give Plus a badge.

import { Star, Sparkles, Crown, Award, type LucideIcon } from "lucide-react";
import { TIER_PERK_MATRIX, normalizeTier, type TierId } from "../../supabase/functions/_shared/tierPerks";

export interface TierBadgeStyle {
  /** Lucide mark drawn beside the tier name. */
  icon: LucideIcon;
  /** CSS colour for the icon and label. */
  color: string;
  /** Chip class for the pill-shaped variants (HelperBadges). */
  chipClass: string;
  /**
   * Icon colour INSIDE a gold chip. The chip variants sit on a gold-tinted
   * ground where the sienna mark loses contrast, so Pro/Plus wear the gold
   * there and the accent colour on the flat surfaces. Both values existed
   * already in the two call sites; naming the difference here is what stops it
   * being re-derived a third time.
   */
  chipIconColor: string | undefined;
  /**
   * The profile-header chip (IdentityHeader): its own mark, its own read
   * colour and its own wash. Kept as a distinct set rather than folded into
   * the two above because the values are not cosmetic preference — Pro wears
   * `Award` there so the three rungs read as one ladder, and Elite's label is
   * `--gold-ink` on a `--gold-warm` wash because gold-on-gold measured 2.53:1
   * in light mode at 9px bold. Every value here is carried over unchanged from
   * the per-tier blocks it replaced; only Plus is new.
   */
  headerIcon: LucideIcon;
  headerColor: string;
  headerBackground: string;
  /**
   * `box-shadow` ring around the profile avatar. Basic deliberately keeps the
   * SAME thin neutral ring a free account gets — the ring is prestige, and
   * prestige starts at Pro — so this is not simply `headerColor` at 2.5px.
   * That exception is why the value is stored rather than computed.
   */
  avatarRing: string;
  /**
   * Whether this tier reads as PRESTIGE — the gold/sienna treatment that the
   * hiring surfaces (avatar halo, applicant-name pill) reserve for Pro and
   * above. Basic is a paid tier that still wears the neutral chip, which is
   * why "has a badge" and "gets a halo" are two different questions.
   */
  prestige: boolean;
}

/** The ring a free account (and Basic, see above) wears. */
export const NEUTRAL_AVATAR_RING = "0 0 0 2px hsl(var(--bark) / 0.18)";

const STYLES: Record<Exclude<TierId, "free">, TierBadgeStyle> = {
  basic: {
    icon: Star,
    color: "hsl(var(--bark))",
    chipClass: "bg-secondary/80 text-secondary-foreground border border-border",
    chipIconColor: undefined,
    headerIcon: Star,
    headerColor: "hsl(var(--bark))",
    headerBackground: "hsl(var(--bark) / 0.10)",
    avatarRing: "0 0 0 2px hsl(var(--bark) / 0.18)",
    prestige: false,
  },
  pro: {
    icon: Sparkles,
    color: "hsl(var(--burnt-sienna))",
    chipClass: "tier-gold-pro",
    chipIconColor: "hsl(var(--gold-warm))",
    headerIcon: Award,
    headerColor: "hsl(var(--burnt-sienna))",
    headerBackground: "hsl(var(--burnt-sienna) / 0.12)",
    avatarRing: "0 0 0 2.5px hsl(var(--burnt-sienna))",
    prestige: true,
  },
  plus: {
    icon: Sparkles,
    color: "hsl(var(--burnt-sienna))",
    chipClass: "tier-gold-pro",
    chipIconColor: "hsl(var(--gold-warm))",
    headerIcon: Award,
    headerColor: "hsl(var(--burnt-sienna))",
    headerBackground: "hsl(var(--burnt-sienna) / 0.12)",
    avatarRing: "0 0 0 2.5px hsl(var(--burnt-sienna))",
    prestige: true,
  },
  elite: {
    icon: Crown,
    color: "hsl(var(--gold-warm))",
    chipClass: "tier-gold-elite",
    chipIconColor: "hsl(var(--gold-warm))",
    headerIcon: Crown,
    headerColor: "hsl(var(--gold-ink))",
    headerBackground: "hsl(var(--gold-warm) / 0.14)",
    avatarRing: "0 0 0 2.5px hsl(var(--gold-warm))",
    prestige: true,
  },
};

/**
 * Badge treatment for a raw `subscription_tier`, or null when the tier earns
 * no badge at all (free, null, expired-and-resolved, unknown ids). Gated on
 * the same `tierBadge` perk the trust rows open on, so a tier can never be
 * badge-worthy in one place and invisible in another.
 */
export function tierBadgeStyle(raw: string | null | undefined): TierBadgeStyle | null {
  const tier = normalizeTier(raw);
  if (!TIER_PERK_MATRIX[tier].tierBadge) return null;
  return STYLES[tier as Exclude<TierId, "free">];
}
