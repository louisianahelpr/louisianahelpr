import { Star, Trophy, Zap, Shield, Flame, Heart, Crown, Target, Sparkles } from "lucide-react";

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

  // Tier badges — always first
  if (stats.helprTier === "elite") {
    badges.push({
      key: "elite_sub",
      label: "Elite Helpr",
      icon: <Crown className="w-3 h-3" />,
      color: "bg-accent/20 text-accent-foreground border border-accent/30",
    });
  } else if (stats.helprTier === "pro" || stats.isPro) {
    badges.push({
      key: "pro",
      label: "Pro Helpr",
      icon: <Sparkles className="w-3 h-3" />,
      color: "bg-primary/20 text-primary border border-primary/30",
    });
  } else if (stats.helprTier === "basic") {
    badges.push({
      key: "basic_sub",
      label: "Basic Helpr",
      icon: <Star className="w-3 h-3" />,
      color: "bg-secondary/80 text-secondary-foreground border border-border",
    });
  }

  // 👑 Elite Helpr: 25+ completed jobs, 4.8+ rating, 10+ reviews
  if (stats.completedJobs >= 25 && stats.avgRating >= 4.8 && stats.reviewCount >= 10) {
    badges.push({
      key: "elite",
      label: "Elite Helpr",
      icon: <Crown className="w-3 h-3" />,
      color: "bg-primary/15 text-primary border border-primary/20",
    });
  }

  // 🏆 Top Rated: 4.8+ rating with 3+ reviews
  if (stats.avgRating >= 4.8 && stats.reviewCount >= 3) {
    badges.push({
      key: "top_rated",
      label: "Top Rated",
      icon: <Trophy className="w-3 h-3" />,
      color: "bg-accent/15 text-accent-foreground",
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
      color: "bg-accent/15 text-accent-foreground",
    });
  } else if (stats.completedJobs >= 15) {
    badges.push({
      key: "fast_responder",
      label: "Fast Responder",
      icon: <Zap className="w-3 h-3" />,
      color: "bg-accent/15 text-accent-foreground",
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
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${badge.color}`}
        >
          {badge.icon}
          {badge.label}
        </span>
      ))}
    </div>
  );
}
