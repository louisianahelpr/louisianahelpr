/**
 * useAdminUsersFilter
 *
 * Tab / sort types and the client-side reorder for the admin user list.
 * Filtering moved server-side in Q232 (adminUsersQuery.ts).
 */
import type { Profile } from "../adminUserHelpers";

// No "pending" / "denied" tabs: approval review was retired in Q193 (owner,
// 2026-09-23). "approved" (labelled Active) = email confirmed and not banned.
export type Tab = "awaiting_email" | "approved" | "banned" | "all";

export type SortDir =
  | "desc"
  | "asc"
  | "alpha"
  | "standing_worst"
  | "standing_best"
  | "pay_high"
  | "pay_low"
  | "joined_new"
  | "joined_old"
  | "never_logged_in";

interface SortDeps {
  profiles: Profile[];
  sortDir: SortDir;
  strikesSummary: Record<string, number>;
  lastLoginSummary: Record<string, string>;
  paySummary: Record<string, number>;
}

/**
 * Tab, search and the column sorts (alpha / joined) run in Postgres now
 * (adminUsersQuery.ts, Q232), so the rows arrive already filtered and in
 * server order. This only reorders the LOADED rows for the sorts that read
 * another table's data (last login, pay, strikes); for a server sort it
 * returns the rows untouched.
 */
export const sortLoadedProfiles = ({
  profiles,
  sortDir,
  strikesSummary,
  lastLoginSummary,
  paySummary,
}: SortDeps): Profile[] => {
  if (sortDir === "alpha" || sortDir === "joined_new" || sortDir === "joined_old") return profiles;
  return [...profiles].sort((a, b) => {
    if (sortDir === "standing_worst" || sortDir === "standing_best") {
      const aStrikes = strikesSummary[a.user_id] || 0;
      const bStrikes = strikesSummary[b.user_id] || 0;
      if (aStrikes !== bStrikes) {
        return sortDir === "standing_worst" ? bStrikes - aStrikes : aStrikes - bStrikes;
      }
      // Tiebreaker: most recent login
      const aLogin = lastLoginSummary[a.user_id];
      const bLogin = lastLoginSummary[b.user_id];
      if (!aLogin && !bLogin) return 0;
      if (!aLogin) return 1;
      if (!bLogin) return -1;
      return new Date(bLogin).getTime() - new Date(aLogin).getTime();
    }
    if (sortDir === "pay_high" || sortDir === "pay_low") {
      const aPay = paySummary[a.user_id] || 0;
      const bPay = paySummary[b.user_id] || 0;
      return sortDir === "pay_high" ? bPay - aPay : aPay - bPay;
    }
    if (sortDir === "never_logged_in") {
      // Never-logged-in users first, then those with the oldest signup date among them.
      // Logged-in users fall to the bottom, sorted by most recent login last.
      const aLogin = lastLoginSummary[a.user_id];
      const bLogin = lastLoginSummary[b.user_id];
      if (!aLogin && !bLogin) {
        // Both never logged in — oldest signups first (most concerning)
        return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
      }
      if (!aLogin) return -1;
      if (!bLogin) return 1;
      return new Date(bLogin).getTime() - new Date(aLogin).getTime();
    }
    const aLogin = lastLoginSummary[a.user_id];
    const bLogin = lastLoginSummary[b.user_id];
    if (!aLogin && !bLogin) return 0;
    if (!aLogin) return 1;
    if (!bLogin) return -1;
    const diff = new Date(bLogin).getTime() - new Date(aLogin).getTime();
    return sortDir === "desc" ? diff : -diff;
  });
};
