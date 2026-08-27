import { Star, Trophy, Zap, Shield, Flame, Heart, Crown, Target, Sparkles } from "lucide-react";
// Membership badge labels come from the ONE tier-name source so a badge on a
// helper card reads exactly like the plan card that sold it ("Helpr Pro", not
// "Pro"). The EARNED Elite badge further down is a different thing entirely —
// a performance ladder rung, not a purchase — and deliberately keeps its own
// bare "Elite" label.
import { TIER_PERKS } from "@/lib/subscriptionTiers";

export type HelperBadge = {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
};

export function computeBadges(stats: {
  avgRating: number;
  reviewCount: number;
  completedJobs: number;
  cancellations?: number;
  responseHours?: number;
  memberSinceDays?: number;
  isPro?: boolean;
  helprTier?: string | null;
}): HelperBadge[] {
  const badges: HelperBadge[] = [];

  // Tier badges — always first. Pro + Elite are paid prestige tiers, so
  // they wear the antique gold (matches the wrought-iron logo finials).
  // Basic stays neutral so the gold reads as something earned.
  if (stats.helprTier === "elite") {
    badges.push({
      key: "elite_sub",
      label: TIER_PERKS.elite.name,
      icon: <Crown className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} />,
      color: "tier-gold-elite",
    });
  } else if (stats.helprTier === "pro" || stats.isPro) {
    badges.push({
      key: "pro",
      label: TIER_PERKS.pro.name,
      icon: <Sparkles className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} />,
      color: "tier-gold-pro",
    });
  } else if (stats.helprTier === "basic") {
    badges.push({
      key: "basic_sub",
      label: TIER_PERKS.basic.name,
      icon: <Star className="w-3 h-3" />,
      color: "bg-secondary/80 text-secondary-foreground border border-border",
    });
  }

  // There is deliberately NO earned "Elite" badge here any more. It fired at
  // 25+ jobs / 4.8+ / 10+ reviews with the same Crown, the same gold and the
  // same word as the SUBSCRIPTION badge above, so an Elite member who had
  // also earned it rendered "Elite" twice, visually identical, with nothing
  // distinguishing purchase from achievement. Those thresholds are also the
  // verification ladder's top rung (TIER_THRESHOLDS.elite, helperTier.ts),
  // and HelperTierBadge renders that rung right beside this row on both
  // profile surfaces — so the achievement is not lost, it is simply stated
  // once, by the pill that can explain itself (progression popover).
  // Owner ruling 2026-08-25: "Elite" names the paid membership, nothing else.

  // 🏆 Highly Rated: 4.8+ rating with 3+ reviews — gold-trimmed trophy.
  // NOT "Top Rated": that is now the ladder's top rung, which sits on the
  // same screen behind a far higher bar (25+ jobs). Two chips inches apart
  // reading identically for different achievements is the exact collision
  // this pass exists to remove.
  if (stats.avgRating >= 4.8 && stats.reviewCount >= 3) {
    badges.push({
      key: "top_rated",
      label: "Highly Rated",
      icon: <Trophy className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} />,
      color: "tier-gold-soft",
    });
  }

  // ⭐ Trusted Helpr: 5+ completed jobs, 4.0+ rating
  if (stats.completedJobs >= 5 && stats.avgRating >= 4.0) {
    badges.push({
      key: "trusted",
      label: "Trusted",
      icon: <Shield className="w-3 h-3" />,
      color: "bg-primary/10 text-primary",
    });
  }

  // 🔥 On a Streak: 10+ completed jobs (high activity)
  if (stats.completedJobs >= 10) {
    badges.push({
      key: "streak",
      label: "On Fire",
      icon: <Flame className="w-3 h-3" />,
      color: "bg-destructive/10 text-destructive",
    });
  }

  // ⚡ Fast Responder: based on actual response time if available
  if (stats.responseHours !== undefined && stats.responseHours < 2) {
    badges.push({
      key: "fast_responder",
      label: "Fast Responder",
      icon: <Zap className="w-3 h-3" />,
      color: "bg-accent/15 text-accent",
    });
  } else if (stats.completedJobs >= 15) {
    badges.push({
      key: "fast_responder",
      label: "Fast Responder",
      icon: <Zap className="w-3 h-3" />,
      color: "bg-accent/15 text-accent",
    });
  }

  // 🎯 Reliable: 0 cancellations with 5+ jobs
  if (stats.cancellations !== undefined && stats.cancellations === 0 && stats.completedJobs >= 5) {
    badges.push({
      key: "reliable",
      label: "Reliable",
      icon: <Target className="w-3 h-3" />,
      color: "bg-primary/10 text-primary",
    });
  }

  // ❤️ Community Favorite: 15+ reviews
  if (stats.reviewCount >= 15) {
    badges.push({
      key: "community_fav",
      label: "Community Fav",
      icon: <Heart className="w-3 h-3" />,
      color: "bg-destructive/10 text-destructive",
    });
  }

  // 🌟 Rising Star: 3+ completed, <10, good rating
  if (stats.completedJobs >= 3 && stats.completedJobs < 10 && stats.avgRating >= 4.0) {
    badges.push({
      key: "rising_star",
      label: "Rising Star",
      icon: <Star className="w-3 h-3" />,
      color: "bg-secondary text-secondary-foreground",
    });
  }

  // Cap at 4 badges max for clean display
  return badges.slice(0, 4);
}

export function HelperBadges({ badges }: { badges: HelperBadge[] }) {
  if (badges.length === 0) return null;

  return (
    // gap-1.5 gives each pill a bit more breathing room on crowded rows
    <div className="flex flex-wrap gap-1.5">
      {badges.map((badge) => (
        // rounded-ds-pill + min-h-[22px] keeps every badge on-axis with
        // StatusBadge pills and meets the 40px tap-target guideline when
        // wrapped in a pressable parent. The tinted-glass look comes from
        // the tier-gold-* CSS classes (which carry gradient + border + shadow)
        // or the bg-*/text-* pairs for earned badges.
        <span
          key={badge.key}
          className={[
            "inline-flex items-center gap-1 rounded-ds-pill",
            "px-2.5 py-[3px] text-ds-10 font-semibold leading-none",
            "min-h-[22px]",
            badge.color,
          ].join(" ")}
        >
          {/* Icon is already sized w-3 h-3 (12px) in computeBadges — the
              shrink-0 here prevents it from collapsing if the label is long */}
          <span className="shrink-0 inline-flex items-center">{badge.icon}</span>
          {badge.label}
        </span>
      ))}
    </div>
  );
}
