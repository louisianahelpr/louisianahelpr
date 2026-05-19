/**
 * useAdminUsersFilter
 *
 * Pure filter + sort logic for the admin user list.
 * Extracted verbatim from AdminUsers.tsx — behaviour-preserving structural
 * refactor.
 */
import type { Profile } from "../adminUserHelpers";
import { isPendingReview, isAwaitingEmail, isVerifiedEmail } from "../adminUserHelpers";

export type Tab = "pending" | "awaiting_email" | "approved" | "denied" | "banned" | "all";
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

interface FilterDeps {
  profiles: Profile[];
  tab: Tab;
  searchQuery: string;
  sortDir: SortDir;
  strikesSummary: Record<string, number>;
  lastLoginSummary: Record<string, string>;
  paySummary: Record<string, number>;
}

export const filterAndSortProfiles = ({
  profiles,
  tab,
  searchQuery,
  sortDir,
  strikesSummary,
  lastLoginSummary,
  paySummary,
}: FilterDeps): Profile[] => {
  return profiles.filter((p) => {
    // Tab filter
    if (tab === "pending" && !isPendingReview(p)) return false;
    else if (tab === "awaiting_email" && !isAwaitingEmail(p)) return false;
    else if (tab === "approved" && !(p.approval_status === "approved" && !["temp_banned", "permanently_banned"].includes(p.ban_status || ""))) return false;
    else if (tab === "denied" && (p.approval_status !== "denied" || (p as { role?: string }).role === "customer")) return false;
    else if (tab === "banned" && !["temp_banned", "permanently_banned"].includes(p.ban_status || "")) return false;

    // Search by name (also matches email for convenience)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const hay = `${p.full_name || ""} ${p.email || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  }).sort((a, b) => {
    if (sortDir === "alpha") {
      const aName = (a.full_name || a.email || "").toLowerCase();
      const bName = (b.full_name || b.email || "").toLowerCase();
      return aName.localeCompare(bName);
    }
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
    if (sortDir === "joined_new" || sortDir === "joined_old") {
      const aJoined = new Date(a.created_at || 0).getTime();
      const bJoined = new Date(b.created_at || 0).getTime();
      return sortDir === "joined_new" ? bJoined - aJoined : aJoined - bJoined;
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

export const getTabCounts = (
  profiles: Profile[],
  isUnseen: (p: Profile) => boolean,
) => {
  const pendingCount = profiles.filter((p) => isPendingReview(p)).length;
  const awaitingEmailCount = profiles.filter((p) => isAwaitingEmail(p)).length;
  const bannedCount = profiles.filter(
    (p) => ["temp_banned", "permanently_banned"].includes(p.ban_status || "") && isUnseen(p),
  ).length;
  const approvedCount = profiles.filter(
    (p) =>
      p.approval_status === "approved" &&
      !["temp_banned", "permanently_banned"].includes(p.ban_status || "") &&
      isUnseen(p),
  ).length;
  const deniedCount = profiles.filter(
    (p) => p.approval_status === "denied" && isUnseen(p),
  ).length;
  const allCount = profiles.filter(isUnseen).length;

  return { pendingCount, awaitingEmailCount, bannedCount, approvedCount, deniedCount, allCount };
};

// Unused but exported to avoid import-only-types errors
export { isVerifiedEmail };
