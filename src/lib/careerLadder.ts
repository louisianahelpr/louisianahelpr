export interface CareerMilestone {
  id: string;
  label: string;
  description: string;
  icon: string; // Lucide icon name
  color: string; // hsl value
  requirement: {
    completedJobs?: number;
    avgRating?: number;
    repeatHirePercent?: number;
    credentialTier?: number;
    communityPosts?: number;
    endorsements?: number;
  };
}

const CAREER_MILESTONES: CareerMilestone[] = [
  {
    id: "first_job",
    label: "First Job",
    description: "Completed your first job on Helpr",
    icon: "Star",
    color: "hsl(40 60% 55%)",
    requirement: { completedJobs: 1 },
  },
  {
    id: "rising_star",
    label: "Rising Star",
    description: "5 jobs completed",
    icon: "TrendingUp",
    color: "hsl(40 70% 50%)",
    requirement: { completedJobs: 5 },
  },
  {
    id: "trusted_helpr",
    label: "Trusted Helpr",
    description: "10 jobs with a 4.5+ average rating",
    icon: "ShieldCheck",
    color: "hsl(155 50% 40%)",
    requirement: { completedJobs: 10, avgRating: 4.5 },
  },
  {
    id: "neighborhood_pro",
    label: "Neighborhood Pro",
    description: "25 jobs completed",
    icon: "Award",
    color: "hsl(var(--burnt-sienna))",
    requirement: { completedJobs: 25 },
  },
  {
    id: "community_pillar",
    label: "Community Pillar",
    description: "50 jobs · 4.8+ rating · 3+ repeat clients",
    icon: "Users",
    color: "hsl(210 60% 45%)",
    requirement: { completedJobs: 50, avgRating: 4.8, repeatHirePercent: 20 },
  },
  {
    id: "elite_helpr",
    label: "Elite Helpr",
    description: "100 jobs completed",
    icon: "Crown",
    color: "hsl(var(--gold-warm))",
    requirement: { completedJobs: 100 },
  },
  {
    id: "licensed_pro",
    label: "Licensed Pro",
    description: "Verified license on file",
    icon: "BadgeCheck",
    color: "hsl(260 60% 55%)",
    requirement: { credentialTier: 2 },
  },
  {
    id: "master_helpr",
    label: "Master Helpr",
    description: "200 jobs · 4.9+ rating",
    icon: "Gem",
    color: "hsl(280 70% 55%)",
    requirement: { completedJobs: 200, avgRating: 4.9 },
  },
];

export interface MilestoneStats {
  completedJobs: number;
  avgRating: number;
  repeatHirePercent: number;
  credentialTier: number;
}

export function getEarnedMilestones(stats: MilestoneStats): CareerMilestone[] {
  return CAREER_MILESTONES.filter((m) => {
    const r = m.requirement;
    if (r.completedJobs && stats.completedJobs < r.completedJobs) return false;
    if (r.avgRating && stats.avgRating < r.avgRating) return false;
    if (r.repeatHirePercent && stats.repeatHirePercent < r.repeatHirePercent) return false;
    if (r.credentialTier && stats.credentialTier < r.credentialTier) return false;
    return true;
  });
}

export function getNextMilestone(stats: MilestoneStats): CareerMilestone | null {
  const earned = getEarnedMilestones(stats);
  const earnedIds = new Set(earned.map((m) => m.id));
  return CAREER_MILESTONES.find((m) => !earnedIds.has(m.id)) ?? null;
}

/**
 * Returns progress info toward the next milestone.
 * Primary metric is completedJobs (most commonly gating).
 */
export function getMilestoneProgress(
  next: CareerMilestone,
  stats: MilestoneStats,
): { current: number; target: number; label: string } | null {
  if (!next.requirement.completedJobs) return null;
  const target = next.requirement.completedJobs;
  const current = Math.min(stats.completedJobs, target);
  const remaining = target - current;
  return {
    current,
    target,
    label: `${current}/${target} job${target === 1 ? "" : "s"} (${remaining} to go)`,
  };
}
