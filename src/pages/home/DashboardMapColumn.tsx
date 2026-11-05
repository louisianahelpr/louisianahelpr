import { Suspense } from "react";
import { toast } from "sonner";
import { openJobFromPin } from "@/components/browseMap/openJobFromPin";
import { Skeleton } from "@/components/ui/skeleton";
import type { useDashboardFilters } from "@/hooks/useDashboardFilters";
import type { ViewerFeedExclusions } from "@/pages/home/viewerFeedExclusions";
import type { EnrichedJob } from "@/components/dashboard/types";
import { BrowseMap } from "./dashboardLazyParts";
import type { useDetailJob } from "./useDetailJob";

/**
 * Jobs > Browse's desktop map column, moved out of src/pages/home/Dashboard.tsx unchanged (Q806, the
 * god-component ratchet). Dashboard still decides WHEN it shows (web desktop, map on, no load-error card,
 * not "wants quotes").
 */
export function DashboardMapColumn({
  filters,
  allJobs,
  openDetailJob,
  userId,
  effectiveFee,
  exclusions,
  refreshKey,
}: {
  filters: ReturnType<typeof useDashboardFilters>;
  allJobs: EnrichedJob[];
  openDetailJob: ReturnType<typeof useDetailJob>["openDetailJob"];
  userId: string | undefined;
  effectiveFee: number;
  exclusions: ViewerFeedExclusions;
  refreshKey: number;
}) {
  return (
    <div
      className="w-[48%] shrink-0 min-h-0 flex flex-col"
      style={{ borderLeft: "1px solid hsl(var(--olivewood) / 0.12)" }}
    >
      <Suspense fallback={<Skeleton className="h-full w-full rounded-2xl" />}>
        <BrowseMap
          flush
          // Same job-detail dialog the feed's cards open on
          // tap (openDetailJob), not the quick-apply sheet —
          // see the matching note in BrowseTasksFeed.tsx.
          //
          // VN-10: this was `allJobs.find(...)` alone, so a pin
          // for a job this page had not loaded (or had filtered
          // out — own posts, past-dated, already applied) was a
          // dead tap. Measured on prod at 1440, 2026-09-14:
          // "Pressure wash a driveway and patio" was pinned,
          // absent from the list, and its card did nothing.
          // `openJobFromPin` is the one lookup both maps use.
          onJobAction={(jobId) =>
            openJobFromPin({
              jobId,
              lists: [filters.filteredJobs, allJobs],
              open: openDetailJob,
              onError: (m) => toast.error(m),
            })
          }
          currentUserId={userId}
          filters={filters.mapFilter}
          onClearFilters={filters.clearFilters}
          // MUST match the feed column beside it. Without this
          // prop BrowseMap falls back to guest pricing and the
          // pin preview prints the GROSS budget, so on this exact
          // screen "Pressure wash a house exterior" read $368 in
          // the list and $400 on the map, side by side, for the
          // same job (caught 2026-08-31 at 1440). Same value the
          // list's JobCards use — one number per job, everywhere.
          effectiveFee={effectiveFee}
          // Every viewer-local cull the feed applies — applied,
          // dismissed, "Only saved" — so the pins, the cards and
          // the header count describe ONE set. Optimistic apply
          // and dismiss both update it, so a pin vanishes the
          // moment the card does.
          exclusions={exclusions}
          // Re-read the pins whenever the list re-reads, so the
          // map never shows a board older than the list beside it.
          refreshKey={refreshKey}
        />
      </Suspense>
    </div>
  );
}
