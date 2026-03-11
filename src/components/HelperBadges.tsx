import { Star, Trophy, Zap, Shield } from "lucide-react";

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
}): HelperBadge[] {
  const badges: HelperBadge[] = [];

  // ⭐ Trusted Helper: 5+ completed jobs, 4.0+ rating
  if (stats.completedJobs >= 5 && stats.avgRating >= 4.0) {
    badges.push({
      key: "trusted",
      label: "Trusted Helper",
      icon: <Shield className="w-3 h-3" />,
      color: "bg-primary/10 text-primary",
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

  // ⚡ Fast Responder: 10+ completed jobs (proxy for responsiveness)
  if (stats.completedJobs >= 10) {
    badges.push({
      key: "fast_responder",
      label: "Fast Responder",
      icon: <Zap className="w-3 h-3" />,
      color: "bg-accent/15 text-accent-foreground",
    });
  }

  return badges;
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
