import { useMemo } from "react";
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
  openQueues: { stalled?: number } & QueueCounts,
): number | undefined {
  const uc = unreadCounts[id];
  if (uc && uc > 0) return uc;
  // Q1071: the open Stuck Jobs (escalated, unresolved), like disputes: a count
  // of held escrow waiting on a person, not an "unseen since" number, so a
  // visit does not clear it.
  if (id === "stalled" && (openQueues.stalled ?? 0) > 0) return openQueues.stalled;
  // Q1691: the five queues that had no number, each a count of what its screen
  // lists as waiting (useOpenQueueCounts below). Not "unseen since", so a visit
  // does not clear them.
  if (id === "banreview" && (openQueues.banreview ?? 0) > 0) return openQueues.banreview;
  if (id === "credentials" && (openQueues.credentials ?? 0) > 0) return openQueues.credentials;
  if (id === "exceptions" && (openQueues.exceptions ?? 0) > 0) return openQueues.exceptions;
  if (id === "fraud" && (openQueues.fraud ?? 0) > 0) return openQueues.fraud;
  if (id === "idvreview" && (openQueues.idvreview ?? 0) > 0) return openQueues.idvreview;
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

/**
 * Q1691: the five admin queues that had no rail count (Ban Review, License &
 * Insurance, Exception Queue, Fraud, Identity Review). Each counts what its
 * screen lists as waiting, from the same read the screen makes, test accounts
 * left out like every other rail count. Each key sits under its screen's own
 * query-key prefix, so the screen's invalidation after a decision refreshes
 * the number too. A failed read throws (unwrap) and shows as the page's data
 * error, never as a confident zero; a table or RPC not yet deployed is no
 * badge, as the screens treat it.
 */
const notDeployed = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === "PGRST202" || !!error.message?.includes("does not exist"));

async function realUsers(userIds: (string | null | undefined)[]): Promise<string[]> {
  const seed = await fetchSeedUserIds(userIds);
  return userIds.filter((id): id is string => !!id && !seed.has(id));
}

export type QueueCounts = {
  banreview?: number;
  credentials?: number;
  exceptions?: number;
  fraud?: number;
  idvreview?: number;
};

export function useOpenQueueCounts(enabled: boolean): { data: QueueCounts; isError: boolean } {
  const opts = { enabled, staleTime: 60_000 } as const;
  // AdminBanReview: one open case per person (pending_ban_review rows collapsed by user).
  const banreview = useQuery({
    ...opts,
    queryKey: ["admin-ban-review", "rail-count"],
    queryFn: async () => {
      const res = await supabase.from("user_violations").select("user_id").eq("action_taken", "pending_ban_review");
      if (notDeployed(res.error)) return 0;
      return new Set(await realUsers((unwrap(res) ?? []).map((r) => r.user_id))).size;
    },
  });
  // AdminCredentialQueue: the rows get_pending_credentials returns.
  const credentials = useQuery({
    ...opts,
    queryKey: ["admin-credential-queue", "rail-count"],
    queryFn: async () => {
      const rows = (unwrap(await supabase.rpc("get_pending_credentials")) ?? []) as { user_id: string }[];
      return (await realUsers(rows.map((r) => r.user_id))).length;
    },
  });
  // AdminExceptionQueue: open verification_exceptions.
  const exceptions = useQuery({
    ...opts,
    queryKey: ["admin-exception-queue", "rail-count"],
    queryFn: async () => {
      const res = await supabase.from("verification_exceptions").select("user_id").eq("status", "open");
      if (notDeployed(res.error)) return 0;
      return (await realUsers((unwrap(res) ?? []).map((r) => r.user_id))).length;
    },
  });
  // AdminFraudDashboard: unresolved fraud_flags (its default view).
  const fraud = useQuery({
    ...opts,
    queryKey: ["admin-fraud-flags", "rail-count"],
    queryFn: async () => {
      const rows = unwrap(await supabase.from("fraud_flags").select("user_id").eq("resolved", false)) ?? [];
      return (await realUsers(rows.map((r) => r.user_id))).length;
    },
  });
  // AdminIDVReview: the people in manual_review (the screen's "waiting"; `failed` is its rescue list).
  const idvreview = useQuery({
    ...opts,
    queryKey: ["admin-idv-review", "rail-count"],
    queryFn: async () => {
      const rows = unwrap(
        await supabase.from("profiles").select("user_id, is_seed").eq("idv_status", "manual_review"),
      ) ?? [];
      return rows.filter((r) => r.is_seed !== true).length;
    },
  });
  // Memoized on the five numbers so the rail's publish effect runs only when one moves.
  const data = useMemo<QueueCounts>(
    () => ({
      banreview: banreview.data,
      credentials: credentials.data,
      exceptions: exceptions.data,
      fraud: fraud.data,
      idvreview: idvreview.data,
    }),
    [banreview.data, credentials.data, exceptions.data, fraud.data, idvreview.data],
  );
  return {
    data,
    isError: banreview.isError || credentials.isError || exceptions.isError || fraud.isError || idvreview.isError,
  };
}
