import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { toast } from "@/hooks/use-toast";
import { safeStorage } from "@/lib/safeStorage";
import { maybeCelebrate } from "@/lib/celebrate";
import {
  markCelebrated,
  selectNewMilestones,
  type HelperMilestoneStats,
} from "@/lib/helperMilestones";

/**
 * useHelperMilestones — fires one-shot retention toasts for helper
 * milestones (1st / 5th / 10th / 25th completed job, first $1k in
 * lifetime earnings, first 5-in-a-row 5-star streak). Closes #120.
 *
 * Mount this once on the helper's Earnings tab. It reads the helper's
 * existing stats (no new DB tables, no new RPCs) and surfaces a
 * `toast()` for any milestone the helper just crossed but hasn't been
 * shown for before.
 *
 * Persistence
 * - One `safeStorage` key per (helperId, milestone). `safeStorage`
 *   mirrors `helpr_*` keys into Capacitor Preferences, so the marker
 *   survives WebKit eviction on iOS.
 *
 * Why a hook instead of a component
 * - There is nothing to render — the toast system already owns the
 *   surface. A hook keeps the call site to a single line and avoids
 *   another node in the EarningsTab tree.
 *
 * Why the five-star streak comes from the React Query cache
 * - HelperStreakBadge already runs the canonical streak query with
 *   the `["helper-five-star-streak", helperId]` key. Reading the
 *   cached value here means we share the same fetch — no extra
 *   Supabase round-trip just to fire a celebration.
 */

const STREAK_QUERY_KEY = "helper-five-star-streak";

interface UseHelperMilestonesArgs {
  /** The signed-in helper's user id. When empty, the hook no-ops. */
  helperId: string;
  /**
   * Lifetime number of completed jobs. EarningsTab already derives
   * this from `earningsJobs.filter(j => j.status === 'completed')`.
   */
  completedJobCount: number;
  /**
   * Lifetime net earnings in DOLLARS (not cents). EarningsTab already
   * derives this from the same job list, after platform fee.
   */
  totalEarningsDollars: number;
}

export function useHelperMilestones({
  helperId,
  completedJobCount,
  totalEarningsDollars,
}: UseHelperMilestonesArgs): void {
  const qc = useQueryClient();
  // Guard against double-fire inside a single mount (React 18 strict
  // mode re-runs effects). The effect already gates on safeStorage,
  // but a session-local flag avoids a redundant cascade of toasts in
  // dev and during fast re-renders.
  const firedThisMountRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!helperId) return;
    // Don't celebrate anything until at least one of the inputs is
    // meaningful. A brand-new helper with all zeros has nothing to
    // show. (Stats can briefly be 0 during the first render before
    // queries resolve.)
    if (
      completedJobCount <= 0 &&
      totalEarningsDollars <= 0
    ) {
      return;
    }

    // Read the cached streak value (set by HelperStreakBadge's
    // `useQuery`). When the badge hasn't mounted or the cache hasn't
    // resolved yet, treat the streak as 0 — the streak milestone will
    // simply fire on a later visit once the cache warms.
    const cachedStreak =
      qc.getQueryData<number>([STREAK_QUERY_KEY, helperId]) ?? 0;

    const stats: HelperMilestoneStats = {
      completedJobCount,
      totalEarningsDollars,
      fiveStarStreak: cachedStreak,
    };

    const fresh = selectNewMilestones(safeStorage, helperId, stats);
    if (fresh.length === 0) return;

    // Fire the toasts in canonical order (smallest milestone first).
    // We persist BEFORE rendering the toast so a crash mid-cascade
    // still means "we celebrated, don't replay" — better than
    // double-celebrating on next mount.
    for (const m of fresh) {
      const sessionKey = `${helperId}:${m.id}`;
      if (firedThisMountRef.current.has(sessionKey)) continue;
      firedThisMountRef.current.add(sessionKey);

      markCelebrated(safeStorage, helperId, m.id);

      toast({
        title: m.title,
        description: m.description,
      });
    }

    // Reuse the existing brand confetti utility for the visual beat.
    // It de-dupes itself (caps at 3 fires per event lifetime) so we
    // can call it on every milestone without spamming.
    void maybeCelebrate("first_complete", { particleCount: 100 });
  }, [helperId, completedJobCount, totalEarningsDollars, qc]);
}

export default useHelperMilestones;
