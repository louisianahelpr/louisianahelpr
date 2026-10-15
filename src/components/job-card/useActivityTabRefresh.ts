import { useCallback } from "react";
import { toast } from "sonner";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { hapticSuccess } from "@/lib/haptics";
import { upgradeUnverifiedArrival } from "@/lib/arrivalRefresh";
import type { AppliedApp, Tab } from "@/components/job-card/activityConstants";

/**
 * Pull-to-refresh for My Posts / My Jobs (moved out of JobListPage.tsx
 * unchanged, to keep that page under its component-size baseline).
 *
 * Refetches this tab's core + detail queries only (the other tab has its own
 * keys and its own idle warm), and each Activity instance ("/posts" vs
 * "/jobs") tracks its own pull-state so one tab's refresh never leaks into
 * the other.
 */
export function useActivityTabRefresh({
  tab,
  userId,
  appliedApps,
  refresh,
}: {
  tab: Tab;
  userId: string | undefined;
  appliedApps: AppliedApp[];
  refresh: () => Promise<unknown>;
}) {
  const tabRefresh = useCallback(async () => {
    /* THE GESTURE ALSO RE-CHECKS AN UNVERIFIED ARRIVAL (owner, 2026-09-19).
       It is what replaces the "Try My Location Again" chip the same ruling
       removed from the job card's action row — and it had to be built first,
       because that chip was measurably the ONLY claimed -> verified path in
       the product (the row's primary in that state reads "Start Working", not
       "Mark Arrived", so there was nothing else to re-tap).

       DELIBERATELY NOT AWAITED. The gesture's advertised job is refreshing the
       list, and it must finish on time whatever geolocation does — a denied
       prompt or a 15-second timeout cannot be allowed to hold the refresh
       spinner open. `upgradeUnverifiedArrival` never throws, asks for a fix
       ONLY when there is an arrival it could upgrade (so an ordinary refresh
       triggers no prompt and no write at all), and remembers a denial for the
       page's life rather than re-prompting on every pull. The rules and the
       reasoning are in src/lib/arrivalRefresh.ts.

       Only the Helpr's own tab: on My Posts there is nothing a poster could
       check in for. `appliedApps` is this tab's data and the predicate filters
       to `helper_id === user.id` again on top of that. */
    if (tab === "applied" && userId) {
      const uid = userId;
      void upgradeUnverifiedArrival(
        appliedApps.map((a) => ({ id: a.job_id, ...(a.job ?? {}) })),
        uid,
      ).then((res) => {
        // SILENCE UNLESS IT WORKED. A refresh that could not get a fix has
        // broken nothing — the arrival is already recorded and the job is not
        // waiting on it — and the Helpr asked for a refresh, not for this. An
        // apology for unrequested work is worse than saying nothing. The one
        // thing worth interrupting for is the win.
        if (res.outcome === "upgraded") {
          hapticSuccess();
          toast.success("GPS confirmed you were at the job.", { duration: 6000 });
          void refresh();
        }
      });
    }
    await refresh();
  }, [refresh, tab, userId, appliedApps]);
  return usePullToRefresh({ onRefresh: tabRefresh });
}
