export interface CareerMilestone {
  id: string;
  label: string;
  description: string;
  icon: string; // Lucide icon name
  color: string; // hsl value
  requirement: {
    /** Completed jobs WORKED as the Helpr — never jobs posted (VN-14). */
    completedJobs?: number;
    /** Mean of reviews received AS A HELPR (VN-14). */
    avgRating?: number;
    /** Reviews received as a Helpr. A rating floor without a sample floor let
     *  one 5.0 review carry "Trusted Helpr" (VN-14). */
    minReviews?: number;
    repeatHirePercent?: number;
    credentialTier?: number;
    communityPosts?: number;
    endorsements?: number;
  };
}

/**
 * Every job-count and rating rule here is about WORK DONE AS A HELPR (owner,
 * 2026-09-14, VN-14). Callers build `MilestoneStats` with
 * `buildHelperBadgeStats` (src/lib/helperBadgeStats.ts), never from the
 * profile's headline posted+worked totals.
 *
 * Every rating rule carries `minReviews: MIN_RATING_REVIEWS` and says so in its
 * description.
 */
export const MIN_RATING_REVIEWS = 5;

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
    description: `10 jobs · 4.5+ rating from ${MIN_RATING_REVIEWS}+ reviews`,
    icon: "ShieldCheck",
    color: "hsl(155 50% 40%)",
    requirement: { completedJobs: 10, avgRating: 4.5, minReviews: MIN_RATING_REVIEWS },
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
    // Was "3+ repeat posters" over a rule that checks a PERCENTAGE — the
    // description now states the rule it sits on (VN-14).
    description: `50 jobs · 4.8+ rating from ${MIN_RATING_REVIEWS}+ reviews · 20%+ repeat hires`,
    icon: "Users",
    color: "hsl(210 60% 45%)",
    requirement: { completedJobs: 50, avgRating: 4.8, minReviews: MIN_RATING_REVIEWS, repeatHirePercent: 20 },
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
    description: `200 jobs · 4.9+ rating from ${MIN_RATING_REVIEWS}+ reviews`,
    icon: "Gem",
    color: "hsl(280 70% 55%)",
    requirement: { completedJobs: 200, avgRating: 4.9, minReviews: MIN_RATING_REVIEWS },
  },
];

export interface MilestoneStats {
  /** Completed jobs worked as the Helpr. */
  completedJobs: number;
  /** Mean of reviews received as a Helpr; 0 when none. */
  avgRating: number;
  /** Reviews received as a Helpr. */
  reviewCount: number;
  repeatHirePercent: number;
  /** `null` = UNKNOWN (the tier RPC errored or is not callable by this
   *  viewer). Unknown withholds the credential badge without claiming the
   *  person has no license; every other badge is unaffected (VN-14). */
  credentialTier: number | null;
}

export function getEarnedMilestones(stats: MilestoneStats): CareerMilestone[] {
  return CAREER_MILESTONES.filter((m) => {
    const r = m.requirement;
    if (r.completedJobs && stats.completedJobs < r.completedJobs) return false;
    if (r.avgRating && stats.avgRating < r.avgRating) return false;
    if (r.minReviews && stats.reviewCount < r.minReviews) return false;
    if (r.repeatHirePercent && stats.repeatHirePercent < r.repeatHirePercent) return false;
    if (r.credentialTier && (stats.credentialTier === null || stats.credentialTier < r.credentialTier)) return false;
    return true;
  });
}
