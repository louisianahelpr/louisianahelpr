import {
  useProfileStats,
  useProfileReviews,
  useProfileEarnings,
  useProfileSchedule,
  useProfileViolations,
} from "@/hooks/useProfileTabData";
import type { Tab } from "./types";

/**
 * The Profile page's per-tab reads and the values it derives from them, moved
 * verbatim out of Profile.tsx (pure move, so the god-component ratchet holds).
 * Same hooks in the same order as before: the page still calls them on every
 * render, from one place.
 */
export function useProfileTabQueries(userId: string | undefined, tab: Tab) {
  // Per-tab data — each section is its own `enabled`-gated React Query keyed
  // under ["profile", userId, <section>], so switching away from a tab and
  // back hits the cache, in-flight requests dedupe, and the prior
  // loading/loaded flag pairs are gone. Each section still surfaces failures
  // through its own inline <ProfileSectionError /> (driven by `.isError`)
  // rather than a page-level banner — so one section failing never blanks
  // the core profile (name, avatar) that loaded fine.
  const statsQuery = useProfileStats(userId);
  // Reviews feed the reviews tab only — the landing's 2-review hero
  // preview was removed, so fetching on the landing bought nothing.
  const reviewsQuery = useProfileReviews(userId, tab === "reviews");
  // Also enabled on the landing tab so the header earnings-sparkline
  // teaser has its (cheap jobs+tips) data without a second query. The
  // result is cached, so opening the Earnings tab next is instant.
  const earningsQuery = useProfileEarnings(
    userId,
    tab === "earnings" || tab === "payment" || tab === "landing",
  );
  // Schedule data drives the merged Schedule + Availability tab — gate
  // on either sub-view so the calendar grid is hot the moment the user
  // flips the internal toggle from Hours → Calendar.
  // Availability is its own tab again and renders no job list, so it no
  // longer needs the schedule fetch — only the calendar tab does.
  const scheduleQuery = useProfileSchedule(userId, tab === "schedule");
  const violationsQuery = useProfileViolations(userId, tab === "warnings");

  const completedCount = statsQuery.data?.completedCount ?? 0;
  const postedCount = statsQuery.data?.postedCount ?? 0;
  const avgRating = statsQuery.data?.avgRating ?? null;
  const reviewCount = statsQuery.data?.reviewCount ?? 0;
  // Ladder-badge inputs AS A HELPR (VN-14) — same builder as the public profile.
  const helperBadgeStats = statsQuery.data?.helperBadgeStats ?? null;

  const reviews = reviewsQuery.data ?? [];
  const earningsJobs = earningsQuery.data?.jobs ?? [];
  const tips = earningsQuery.data?.tips ?? [];
  const schedulePostedJobs = scheduleQuery.data?.posted ?? [];
  const scheduleAssignedJobs = scheduleQuery.data?.assigned ?? [];
  const violations = violationsQuery.data ?? [];

  return {
    statsQuery,
    reviewsQuery,
    earningsQuery,
    scheduleQuery,
    violationsQuery,
    completedCount,
    postedCount,
    avgRating,
    reviewCount,
    helperBadgeStats,
    reviews,
    earningsJobs,
    tips,
    schedulePostedJobs,
    scheduleAssignedJobs,
    violations,
  };
}
