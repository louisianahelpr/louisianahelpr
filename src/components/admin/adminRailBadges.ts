import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { unwrap } from "@/lib/supabaseResult";
import { fetchSeedUserIds } from "@/components/admin/seedRows";
import { isMissingRpc } from "@/components/admin/adminStalledJobs/stalledQueue";
import { reportsQueueKey, supportQueueKey } from "@/components/admin/adminQueueKeys";

/**
 * The admin rows that are queues of work waiting on a person (adminNavGroups'
 * Queues and Trust & Safety). Each one's number is a count of what its screen
 * lists as waiting, never an "unseen since" number, so a visit does not clear
 * it: the owner never noticed 1 open report and 6 support tickets (2026-10-27,
 * "there needs to be a better way to see these tickets and open reports").
 */
export const ADMIN_QUEUE_IDS = [
  "idvreview", "credentials", "exceptions", "stalled",
  "fraud", "banreview", "disputes", "reports", "support",
] as const;

/** Every queue's open count (useAdminPendingCounts). Absent = not loaded / unreadable. */
export type PendingCounts = { stalled?: number; disputes?: number; reports?: number; support?: number } & QueueCounts;

/**
 * The number on each admin rail row (mobile AdminSidebar, and the desktop left
 * nav DesktopSidebarNav). Guard: src/test/adminQueueRowsHaveBadges.test.ts and
 * src/test/adminNavPendingBadges.test.ts.
 *
 * A queue row shows its open count; any other row shows Admin.tsx's "new since
 * you last looked" number (Jobs, Referrals, Subscriptions).
 */
export function adminBadgeFor(
  id: string,
  unreadCounts: Record<string, number>,
  openQueues: PendingCounts,
): number | undefined {
  // Q1071: the open Stuck Jobs (escalated, unresolved), like disputes: a count
  // of held escrow waiting on a person.
  if (id === "stalled" && (openQueues.stalled ?? 0) > 0) return openQueues.stalled;
  // Q1691: the five queues that had no number, each a count of what its screen
  // lists as waiting (useOpenQueueCounts below).
  if (id === "banreview" && (openQueues.banreview ?? 0) > 0) return openQueues.banreview;
  if (id === "credentials" && (openQueues.credentials ?? 0) > 0) return openQueues.credentials;
  if (id === "exceptions" && (openQueues.exceptions ?? 0) > 0) return openQueues.exceptions;
  if (id === "fraud" && (openQueues.fraud ?? 0) > 0) return openQueues.fraud;
  if (id === "idvreview" && (openQueues.idvreview ?? 0) > 0) return openQueues.idvreview;
  // Owner 2026-10-27: the same three numbers as the Dashboard's Priority Alerts
  // (Admin.tsx feeds those from this same hook), and the same lists as each
  // screen's Open / New / Pending tab.
  if (id === "disputes" && (openQueues.disputes ?? 0) > 0) return openQueues.disputes;
  if (id === "reports" && (openQueues.reports ?? 0) > 0) return openQueues.reports;
  if (id === "support" && (openQueues.support ?? 0) > 0) return openQueues.support;
  if ((ADMIN_QUEUE_IDS as readonly string[]).includes(id)) return undefined;
  const uc = unreadCounts[id];
  if (uc && uc > 0) return uc;
  return undefined;
}

/** The number on the collapsed "Admin" row: everything waiting, across every queue. */
export function adminPendingTotal(openQueues: PendingCounts): number {
  return ADMIN_QUEUE_IDS.reduce((sum, id) => sum + (openQueues[id] ?? 0), 0);
}

/**
 * Q1071: the Stuck Jobs rail count. Its key sits under the screen's own
 * ["admin-stalled-job-queue"] prefix, so the screen's resolve invalidation
 * refreshes the badge too. A failed read throws (unwrap) and shows as the
 * page's data error, never as a confident "nothing stuck" (and the RPC is on
 * prod, so a missing one is a failure too, Q2086). Test jobs (either party a
 * seed account, the screen's own Test tag rule) are left out, like every
 * other rail and dashboard count.
 */
function useStalledQueueCount(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-stalled-job-queue", "rail-count"],
    queryFn: async () => {
      const res = await supabase.rpc("admin_stalled_job_queue", { p_include_resolved: false });
      const stalledRows = unwrap(res) ?? [];
      // Owner 2026-10-23: the same screen lists jobs waiting on the poster's approval
      // (AdminApprovalEscalations), so the rail counts both. Until 20261023143240 reaches the database the
      // second RPC is missing (PGRST202, no hint): counted as none, never as a failure of the first.
      const appr = await supabase.rpc("admin_approval_escalation_queue", { p_include_resolved: false });
      // Only the ones still waiting on a person (the poster may have approved since; lh-money-escrow review #5).
      const approvalRows = (appr.error && isMissingRpc(appr.error) ? [] : (unwrap(appr) ?? [])).filter((r) => r.still_waiting === true);
      const rows: Array<{ customer_id: string | null; helper_id: string | null }> = [...stalledRows, ...approvalRows];
      const seed = await fetchSeedUserIds(rows.flatMap((r) => [r.customer_id, r.helper_id]));
      return rows.filter((r) => !seed.has(r.customer_id ?? "") && !seed.has(r.helper_id ?? "")).length;
    },
    enabled,
    staleTime: 60_000,
  });
}

async function realUsers(userIds: (string | null | undefined)[]): Promise<string[]> {
  const seed = await fetchSeedUserIds(userIds);
  return userIds.filter((id): id is string => !!id && !seed.has(id));
}

type QueueCounts = {
  banreview?: number;
  credentials?: number;
  exceptions?: number;
  fraud?: number;
  idvreview?: number;
};

/**
 * Q1691: the five admin queues that had no rail count (Ban Review, License &
 * Insurance, Exception Queue, Fraud, Identity Review). Each counts what its
 * screen lists as waiting, from the same read the screen makes, test accounts
 * left out like every other rail count. Each key sits under its screen's own
 * query-key prefix, so the screen's invalidation after a decision refreshes
 * the number too. A failed read throws (unwrap) and shows as the page's data
 * error, never as a confident zero (Q2086: no "not
 * deployed yet" branch either; every table and RPC read here is on prod, so a
 * missing one, or a dropped column, is a real failure).
 */
function useOpenQueueCounts(enabled: boolean): { data: QueueCounts; isError: boolean } {
  const opts = { enabled, staleTime: 60_000 } as const;
  // AdminBanReview: one open case per person (pending_ban_review rows collapsed by user).
  const banreview = useQuery({
    ...opts,
    queryKey: ["admin-ban-review", "rail-count"],
    queryFn: async () => {
      const res = await supabase.from("user_violations").select("user_id").eq("action_taken", "pending_ban_review");
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

/**
 * Open disputes, as AdminDisputes' Open tab lists them: jobs in `disputed`,
 * plus decided disputes whose settlement has not executed (stranded money the
 * screen pulls back into Open), test jobs left out. A failed read throws.
 */
async function fetchOpenDisputeCount(): Promise<number> {
  const [open, unsettled] = await Promise.all([
    supabase.from("jobs").select("id, is_seed").eq("status", "disputed"),
    supabase.from("disputes").select("job_id").eq("status", "decided").or("execution_status.is.null,execution_status.neq.executed"),
  ]);
  const openRows = unwrap(open) ?? [];
  const ids = new Set(openRows.filter((j) => j.is_seed !== true).map((j) => j.id));
  const seen = new Set(openRows.map((j) => j.id));
  const stranded = [...new Set((unwrap(unsettled) ?? []).map((r) => r.job_id))].filter((id) => !seen.has(id));
  if (stranded.length > 0) {
    const rows = unwrap(await supabase.from("jobs").select("id, is_seed").in("id", stranded)) ?? [];
    for (const j of rows) if (j.is_seed !== true) ids.add(j.id);
  }
  return ids.size;
}

/**
 * EVERY admin queue's open count, for the left nav on every page (an admin
 * should see a waiting ticket from Home, not only inside /admin), the mobile
 * admin rail and the Dashboard's Priority Alerts. Owner 2026-10-27.
 *
 * Support and Reports read the SAME cache entry as their screen's Pending /
 * New tab (supportQueueKey / reportsQueueKey, and the screen's own fetcher),
 * so the badge, the Priority Alert and the pill are one number. The screens
 * load lazily, so their fetchers are imported on first use: nothing here puts
 * a screen into the nav's own bundle.
 */
export function useAdminPendingCounts(enabled: boolean): { data: PendingCounts; isError: boolean } {
  const opts = { enabled, staleTime: 60_000, gcTime: 5 * 60_000 } as const;
  const stalled = useStalledQueueCount(enabled);
  const queues = useOpenQueueCounts(enabled);
  const support = useQuery({
    ...opts,
    queryKey: supportQueueKey("pending"),
    queryFn: async () => (await import("@/components/admin/AdminSupport")).fetchSupportTickets("pending"),
  });
  const reports = useQuery({
    ...opts,
    queryKey: reportsQueueKey("pending"),
    queryFn: async () => (await import("@/components/admin/AdminReports")).fetchReports("pending"),
  });
  const disputes = useQuery({ ...opts, queryKey: ["admin-disputes", "open-count"], queryFn: fetchOpenDisputeCount });
  const supportN = support.data?.length;
  const reportsN = reports.data?.length;
  const data = useMemo<PendingCounts>(
    () => ({ ...queues.data, stalled: stalled.data, disputes: disputes.data, reports: reportsN, support: supportN }),
    [queues.data, stalled.data, disputes.data, reportsN, supportN],
  );
  return {
    data,
    isError: queues.isError || stalled.isError || disputes.isError || reports.isError || support.isError,
  };
}
