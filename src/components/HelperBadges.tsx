import { Trophy, Zap, Shield, Flame, Heart, Target } from "lucide-react";
// Membership badge labels come from the ONE tier-name source so a badge on a
// helper card reads exactly like the plan card that sold it ("Helpr Pro", not
// "Pro"). The EARNED Elite badge further down is a different thing entirely —
// a performance ladder rung, not a purchase — and deliberately keeps its own
// bare "Elite" label.
import { normalizeTier, tierDisplayName } from "@/lib/subscriptionTiers";
import { tierBadgeStyle } from "@/lib/tierBadgeStyle";

export type HelperBadge = {
  key: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  /** What it means and how it was earned — read by the profile's badge popover. */
  description: string;
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

  // Tier badges — always first, and ONE derived badge rather than an
  // if/else-if chain per tier. The chain this replaces handled
  // elite/pro/basic, so a Plus helper wore no membership badge at all
  // (CC-019). Treatment (mark, chip class, icon colour) comes from
  // tierBadgeStyle, shared with JobPosterCard and IdentityHeader; the
  // gold-for-Elite / neutral-for-Basic rule lives there now.
  //
  // `stats.isPro` is the legacy boolean flag some callers still pass; it
  // continues to mean "treat as Pro" when no tier string is supplied.
  const tierForBadge = stats.helprTier ?? (stats.isPro ? "pro" : null);
  const tierStyle = tierBadgeStyle(tierForBadge);
  if (tierStyle) {
    const TierIcon = tierStyle.icon;
    badges.push({
      key: `tier_${normalizeTier(tierForBadge)}`,
      label: tierDisplayName(tierForBadge),
      description: "A paid Helpr membership.",
      icon: <TierIcon className="w-3 h-3" style={tierStyle.chipIconColor ? { color: tierStyle.chipIconColor } : undefined} />,
      color: tierStyle.chipClass,
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
      description: "A 4.8+ average rating across at least 3 reviews.",
      icon: <Trophy className="w-3 h-3" style={{ color: "hsl(var(--gold-warm))" }} />,
      color: "tier-gold-soft",
    });
  }

  // ⭐ Trusted Helpr: 5+ completed jobs, 4.0+ rating
  if (stats.completedJobs >= 5 && stats.avgRating >= 4.0) {
    badges.push({
      key: "trusted",
      label: "Trusted",
      description: "5 or more completed jobs with a 4.0+ average rating.",
      icon: <Shield className="w-3 h-3" />,
      color: "bg-primary/10 text-primary",
    });
  }

  // 🔥 On a Streak: 10+ completed jobs (high activity)
  if (stats.completedJobs >= 10) {
    badges.push({
      key: "streak",
      label: "On Fire",
      description: "10 or more completed jobs.",
      icon: <Flame className="w-3 h-3" />,
      color: "bg-destructive/10 text-[hsl(var(--destructive-ink))]",
    });
  }

  // ⚡ Fast Responder: based on actual response time if available
  if (stats.responseHours !== undefined && stats.responseHours < 2) {
    badges.push({
      key: "fast_responder",
      label: "Fast Responder",
      description: "Typically replies in under 2 hours.",
      icon: <Zap className="w-3 h-3" />,
      color: "bg-accent/15 text-[hsl(var(--accent-ink))]",
    });
  } else if (stats.completedJobs >= 15) {
    badges.push({
      key: "fast_responder",
      label: "Fast Responder",
      description: "15 or more completed jobs — a steady, active Helpr.",
      icon: <Zap className="w-3 h-3" />,
      color: "bg-accent/15 text-[hsl(var(--accent-ink))]",
    });
  }

  // 🎯 Reliable: 0 cancellations with 5+ jobs
  if (stats.cancellations !== undefined && stats.cancellations === 0 && stats.completedJobs >= 5) {
    badges.push({
      key: "reliable",
      label: "Reliable",
      description: "5 or more completed jobs and no cancellations.",
      icon: <Target className="w-3 h-3" />,
      color: "bg-primary/10 text-primary",
    });
  }

  // ❤️ Community Favorite: 15+ reviews
  if (stats.reviewCount >= 15) {
    badges.push({
      key: "community_fav",
      label: "Community Fav",
      description: "15 or more reviews from the people they have worked with.",
      icon: <Heart className="w-3 h-3" />,
      color: "bg-destructive/10 text-[hsl(var(--destructive-ink))]",
    });
  }

  // "Rising Star" earned badge REMOVED (item 23, 2026-08-30: genuine
  // duplicate). Career Milestones (src/lib/careerLadder.ts) already has a
  // "Rising Star" rung — 5 completed jobs, no rating requirement — that
  // renders in the same masthead. This badge fired on a DIFFERENT
  // definition (3-9 completed jobs AND 4.0+ rating), so a helper could see
  // two chips with the identical name and different, unexplained criteria
  // on one profile. Career Milestones is the canonical ladder (has a
  // description + next-milestone progress); this ad-hoc stat badge deferred
  // to it rather than the reverse, since the ladder is the system with an
  // explainable "why" for its threshold.

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
