import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { isMissingRpc } from "@/components/admin/adminStalledJobs/stalledQueue";
import { fetchSeedUserIds } from "@/components/admin/seedRows";
import type { Stats } from "@/components/admin/dashboard/types";

/**
 * The number on each admin rail row (mobile AdminSidebar and, via
 * publishAdminBadges, the desktop nav). Guard: src/test/adminQueueRowsHaveBadges.test.ts.
 */
export function adminBadgeFor(
  id: string,
  unreadCounts: Record<string, number>,
  stats: Stats,
  openQueues: { stalled?: number },
): number | undefined {
  const uc = unreadCounts[id];
  if (uc && uc > 0) return uc;
  // Q1071: the open Stuck Jobs (escalated, unresolved), like disputes: a count
  // of held escrow waiting on a person, not an "unseen since" number, so a
  // visit does not clear it.
  if (id === "stalled" && (openQueues.stalled ?? 0) > 0) return openQueues.stalled;
  if (id === "disputes" && stats.disputedJobs > 0) return stats.disputedJobs;
  if (id === "reports" && stats.openReports > 0) return stats.openReports;
  if (id === "support" && stats.supportTickets > 0) return stats.supportTickets;
  return undefined;
}

/**
 * Q1071: the Stuck Jobs rail count. Its key sits under the screen's own
 * ["admin-stalled-job-queue"] prefix, so the screen's resolve invalidation
 * refreshes the badge too. A failed read throws (unwrap) and shows as the
 * page's data error, never as a confident "nothing stuck"; an RPC not yet
 * deployed is no badge, as the screen treats it. Test jobs (either party a
 * seed account, the screen's own Test tag rule) are left out, like every
 * other rail and dashboard count.
 */
export function useStalledQueueCount(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-stalled-job-queue", "rail-count"],
    queryFn: async () => {
      const res = await supabase.rpc("admin_stalled_job_queue", { p_include_resolved: false });
      if (res.error && isMissingRpc(res.error)) return 0;
      const rows = unwrap(res) ?? [];
      const seed = await fetchSeedUserIds(rows.flatMap((r) => [r.customer_id, r.helper_id]));
      return rows.filter((r) => !seed.has(r.customer_id ?? "") && !seed.has(r.helper_id ?? "")).length;
    },
    enabled,
    staleTime: 60_000,
  });
}
