/**
 * Q2437: what one "Find a Helpr" card says, pure so it can be tested.
 * No rate of any kind (the poster sets the price), no address (the town the
 * member typed, else their parish).
 */

/** One row of public.find_helprs. */
export interface DirectoryHelpr {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  skills: string | null;
  town: string | null;
  parish: string | null;
  is_id_verified: boolean | null;
}

/** The get_public_profile_stats columns a card reads. */
export interface DirectoryStats {
  user_id: string;
  review_count: number | null;
  avg_rating: number | string | null;
  completed_jobs_as_helper: number | null;
}

const SHOWN_SKILLS = 4;

export function directoryCardFacts(h: DirectoryHelpr, s: DirectoryStats | undefined) {
  const skills = (h.skills ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const reviews = Number(s?.review_count ?? 0);
  const avg = s?.avg_rating === null || s?.avg_rating === undefined ? null : Number(s.avg_rating);
  const done = Number(s?.completed_jobs_as_helper ?? 0);
  const parish = h.parish?.trim() ? `${h.parish.trim()} Parish` : null;
  return {
    name: h.full_name?.trim() || "A neighbor",
    place: h.town?.trim() || parish,
    rating: reviews > 0 && avg !== null && Number.isFinite(avg) ? `${avg.toFixed(1)} (${reviews} ${reviews === 1 ? "review" : "reviews"})` : "New",
    jobsDone: `${done} ${done === 1 ? "job" : "jobs"} done`,
    skills: skills.slice(0, SHOWN_SKILLS),
    moreSkills: Math.max(0, skills.length - SHOWN_SKILLS),
  };
}
