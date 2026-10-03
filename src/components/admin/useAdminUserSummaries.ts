import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { helperFeePercentOrLegacy } from "@/lib/legacyFeeFallback";
import { helperTakeHomeDollars } from "@/lib/helperEarnings";
import { CAPTURED_PAYMENT_STATUSES, isCapturedPayment, withGiftCardPaid } from "@/lib/capturedPayment";
import { loadGiftCardPaidJobIds } from "./giftCardPaidJobIds";
import { REVIEW_COUNT_COLUMNS, countsTowardRating } from "@/lib/reviewStats";
import type { Profile } from "./adminUserHelpers";

/**
 * Per-user supplemental data for the admin user list — ratings, strikes,
 * pay totals, last activity/login, notes, open reports.
 *
 * Extracted from AdminUsers.tsx (step 2 of splitting that 1,900-line
 * file). The loaders are a faithful relocation — identical queries and
 * setX calls. The only change: loadActivitySummary now takes the
 * profiles list as a parameter rather than closing over component state
 * (it reads it for the "Failed ID Upload" activity entry); loadSummaries
 * threads it through, so the caller passes the same value the old
 * closure saw.
 */
export function useAdminUserSummaries() {
  // Per-user admin notes summary: { [user_id]: { count, recent: [{note, created_at, category}] } }
  const [notesSummary, setNotesSummary] = useState<Record<string, { count: number; recent: { note: string; created_at: string; category: string }[] }>>({});
  // Per-user strike counts (from user_violations)
  // `null` = NOT KNOWN (still loading, or the read failed), never "no strikes".
  // Run 36069319716 (#1582): the rows rendered "Good" standing for every
  // account before this map arrived. The type makes each reader decide what an
  // unknown means instead of reading it as zero.
  const [strikesSummary, setStrikesSummary] = useState<Record<string, number> | null>(null);
  // Per-user last activity { [user_id]: { label, at } } — write-only feed
  const [, setActivitySummary] = useState<Record<string, { label: string; at: string }>>({});
  // Per-user last login time
  // `null` = NOT KNOWN, never "never logged in"; see strikesSummary. Every row
  // said "Never logged in" in red until this landed, and for good if the
  // login_history read failed (that error was only logged).
  const [lastLoginSummary, setLastLoginSummary] = useState<Record<string, string> | null>(null);
  // True once every loader below has settled (succeeded or failed). The list
  // is aria-busy until then, so nothing reads a half-filled row as final.
  const [summariesSettled, setSummariesSettled] = useState(false);
  // Per-user pay totals: earned (as helper) + spent (as poster)
  const [paySummary, setPaySummary] = useState<Record<string, number>>({});
  // Per-user rating summary: { avg, count }
  const [ratingSummary, setRatingSummary] = useState<Record<string, { avg: number; count: number }>>({});
  // Per-user completed jobs (helper or poster)
  const [jobsCompletedSummary, setJobsCompletedSummary] = useState<Record<string, number>>({});
  // Per-user open reports/disputes count (filed against them)
  const [openReportsSummary, setOpenReportsSummary] = useState<Record<string, number>>({});

  const loadRatingSummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    // Q321: the rating an admin sees beside a user is the rating everyone else
    // sees. Admin RLS reads every review, including ones still in the blind
    // period, so this used to show 39 where the public profile showed 24.
    const { data, error } = await supabase
      .from("reviews")
      .select(`reviewee_id, ${REVIEW_COUNT_COLUMNS}`)
      .in("reviewee_id", userIds);
    if (error) { console.error("[useAdminUserSummaries] loadRatingSummary:", error); return; }
    if (!data) return;
    const agg: Record<string, { sum: number; count: number }> = {};
    const now = Date.now();
    for (const r of data as unknown as ({ reviewee_id: string; rating: number } & Parameters<typeof countsTowardRating>[0])[]) {
      if (!countsTowardRating(r, now)) continue;
      if (!agg[r.reviewee_id]) agg[r.reviewee_id] = { sum: 0, count: 0 };
      agg[r.reviewee_id].sum += Number(r.rating) || 0;
      agg[r.reviewee_id].count += 1;
    }
    const out: Record<string, { avg: number; count: number }> = {};
    for (const uid of Object.keys(agg)) {
      out[uid] = { avg: agg[uid].sum / agg[uid].count, count: agg[uid].count };
    }
    setRatingSummary(out);
  };

  const loadJobsCompletedSummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    const { data, error } = await supabase
      .from("jobs")
      .select("helper_id, customer_id, status")
      .or(userIds.map((id) => `helper_id.eq.${id},customer_id.eq.${id}`).join(","))
      .eq("status", "completed");
    if (error) { console.error("[useAdminUserSummaries] loadJobsCompletedSummary:", error); return; }
    if (!data) return;
    const counts: Record<string, number> = {};
    for (const j of data) {
      if (j.helper_id && userIds.includes(j.helper_id)) counts[j.helper_id] = (counts[j.helper_id] || 0) + 1;
      if (j.customer_id && userIds.includes(j.customer_id)) counts[j.customer_id] = (counts[j.customer_id] || 0) + 1;
    }
    setJobsCompletedSummary(counts);
  };

  const loadOpenReportsSummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    // Reports filed against the user that are still pending (exclude resolved/dismissed)
    // Disputes: only count those still open AND not yet marked resolved.
    const [reportsRes, disputesRes] = await Promise.all([
      supabase
        .from("reports")
        .select("reported_id, status")
        .in("reported_id", userIds)
        .not("status", "in", "(resolved,dismissed)"),
      supabase
        .from("jobs")
        .select("customer_id, helper_id, dispute_status, dispute_resolved_at")
        .in("dispute_status", ["open", "under_review", "helper_responded"])
        .is("dispute_resolved_at", null),
    ]);
    if (reportsRes.error) console.error("[useAdminUserSummaries] loadOpenReportsSummary reports:", reportsRes.error);
    if (disputesRes.error) console.error("[useAdminUserSummaries] loadOpenReportsSummary disputes:", disputesRes.error);
    const counts: Record<string, number> = {};
    (reportsRes.data)?.forEach((r) => {
      counts[r.reported_id] = (counts[r.reported_id] || 0) + 1;
    });
    (disputesRes.data)?.forEach((j) => {
      if (j.customer_id && userIds.includes(j.customer_id)) counts[j.customer_id] = (counts[j.customer_id] || 0) + 1;
      if (j.helper_id && userIds.includes(j.helper_id)) counts[j.helper_id] = (counts[j.helper_id] || 0) + 1;
    });
    setOpenReportsSummary(counts);
  };

  const loadPaySummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    // `payment_status IN (escrow, payout_pending, released)` is money that has
    // MOVED — it includes escrow still held on jobs that are `open` or
    // `in_progress` and may yet be cancelled or refunded. That is a legitimate
    // thing for an operator to see, but it is NOT lifetime value, and pairing it
    // with a jobs chip counting only `status = 'completed'` put two different
    // denominators side by side in one row: the e2e helper (437de07d) has ONE
    // completed job and FIVE money-bearing ones, so the row read "1 job · $479"
    // — a figure four fifths of which is in-flight escrow on jobs nobody has
    // finished. The chip is now labelled for what this query actually returns
    // (see AdminUserRow), so the number and its noun agree.
    const [{ data, error }, giftCardPaid] = await Promise.all([
      supabase
        .from("jobs")
        .select("id, stripe_payment_intent_id, helper_id, customer_id, budget, helper_fee_percent, platform_fee_amount, urgent_fee, is_group_job, helpers_needed, customer_fee_amount, sales_tax_amount, status, payment_status")
        .or(userIds.map((id) => `helper_id.eq.${id},customer_id.eq.${id}`).join(","))
        .in("payment_status", [...CAPTURED_PAYMENT_STATUSES]),
      loadGiftCardPaidJobIds(),
    ]);
    if (error) { console.error("[useAdminUserSummaries] loadPaySummary:", error); return; }
    if (giftCardPaid.error) { console.error("[useAdminUserSummaries] loadPaySummary gift cards:", giftCardPaid.error); return; }
    if (!data) return;
    const totals: Record<string, number> = {};
    // Q233: a held status without a PaymentIntent is a row nobody charged,
    // unless a gift card paid it (Q443).
    for (const j of withGiftCardPaid(data, giftCardPaid.ids).filter(isCapturedPayment)) {
      const budget = Number(j.budget) || 0;
      if (j.helper_id && userIds.includes(j.helper_id)) {
        // ONE take-home formula (helperEarnings.ts, Q765): roster split, the
        // stamped fee on a released row, and the net urgent bonus. The fallback
        // is the row's own stamped rate (legacy 10% only when unstamped);
        // `??`-semantics keep a stamped 0% comped job at 0%.
        totals[j.helper_id] = (totals[j.helper_id] || 0)
          + helperTakeHomeDollars(j, helperFeePercentOrLegacy(j.helper_fee_percent));
      }
      if (j.customer_id && userIds.includes(j.customer_id)) {
        totals[j.customer_id] = (totals[j.customer_id] || 0)
          + budget + (Number(j.customer_fee_amount) || 0) + (Number(j.sales_tax_amount) || 0);
      }
    }
    setPaySummary(totals);
  };

  const loadStrikesSummary = async (userIds: string[]) => {
    if (userIds.length === 0) { setStrikesSummary({}); return; }
    const { data, error } = await supabase.from("user_violations")
      .select("user_id")
      .in("user_id", userIds);
    if (error) { console.error("[useAdminUserSummaries] loadStrikesSummary:", error); return; }
    if (!data) return;
    const counts: Record<string, number> = {};
    for (const row of data) {
      counts[row.user_id] = (counts[row.user_id] || 0) + 1;
    }
    setStrikesSummary(counts);
  };

  /**
   * Each user's newest login, one row per user (Q428). A global
   * `.order(created_at desc).limit(N)` over login_history let the accounts that
   * sign in most fill the page and read everyone else as "Never logged in";
   * admin_last_logins groups server-side so no user's volume hides another's.
   * PGRST202 (RPC not deployed yet, the window between merge and db-deploy)
   * falls back to the old bounded read rather than showing nothing.
   */
  const loadLastLogins = async (userIds: string[]) => {
    const rpc = await supabase.rpc("admin_last_logins");
    if (rpc.error?.code !== "PGRST202") {
      const wanted = new Set(userIds);
      return { data: rpc.data?.filter((r) => wanted.has(r.user_id)) ?? null, error: rpc.error };
    }
    const old = await supabase.from("login_history").select("user_id, created_at").in("user_id", userIds).order("created_at", { ascending: false }).limit(500);
    return { data: old.data?.map((r) => ({ user_id: r.user_id, last_login_at: r.created_at })) ?? null, error: old.error };
  };

  /**
   * Each user's newest posted job and newest application, one row per user
   * (Q819). Same class as Q428: the newest 500 rows across every listed user
   * would drop quieter users once either table passed 500. PGRST202 (RPC not
   * deployed yet) falls back to the old bounded reads.
   */
  const loadLastActivity = async (userIds: string[]) => {
    const rpc = await supabase.rpc("admin_last_activity");
    if (rpc.error?.code !== "PGRST202") {
      const wanted = new Set(userIds);
      return { data: rpc.data?.filter((r) => wanted.has(r.user_id)) ?? null, error: rpc.error };
    }
    const [jobs, apps] = await Promise.all([
      supabase.from("jobs").select("customer_id, created_at").in("customer_id", userIds).order("created_at", { ascending: false }).limit(500),
      supabase.from("applications").select("helper_id, created_at").in("helper_id", userIds).order("created_at", { ascending: false }).limit(500),
    ]);
    const rows: { user_id: string; last_posted_at: string | null; last_applied_at: string | null }[] = [];
    jobs.data?.forEach((j) => { if (j.customer_id) rows.push({ user_id: j.customer_id, last_posted_at: j.created_at, last_applied_at: null }); });
    apps.data?.forEach((a) => rows.push({ user_id: a.helper_id, last_posted_at: null, last_applied_at: a.created_at }));
    return { data: rows, error: jobs.error ?? apps.error };
  };

  const loadActivitySummary = async (userIds: string[], profiles: Profile[]) => {
    if (userIds.length === 0) { setLastLoginSummary({}); return; }
    const summary: Record<string, { label: string; at: string }> = {};
    // Posted/applied activity and login history, both aggregated per user, in parallel
    const [activityRes, loginRes] = await Promise.all([
      loadLastActivity(userIds),
      loadLastLogins(userIds),
    ]);
    if (activityRes.error) console.error("[useAdminUserSummaries] loadActivitySummary activity:", activityRes.error);
    if (loginRes.error) console.error("[useAdminUserSummaries] loadActivitySummary loginHistory:", loginRes.error);
    const consider = (uid: string, label: string, at?: string | null) => {
      if (!at) return;
      const cur = summary[uid];
      if (!cur || new Date(at) > new Date(cur.at)) summary[uid] = { label, at };
    };
    // Anonymised jobs (null customer_id, since 20260901033011) are excluded
    // on both paths, so a null never indexes `summary`.
    (activityRes.data)?.forEach((r) => {
      consider(r.user_id, "Posted Job", r.last_posted_at);
      consider(r.user_id, "Applied to Job", r.last_applied_at);
    });
    // Track most-recent login separately for the user list row
    const logins: Record<string, string> = {};
    (loginRes.data)?.forEach((l) => {
      consider(l.user_id, "Logged In", l.last_login_at);
      if (!logins[l.user_id] || new Date(l.last_login_at) > new Date(logins[l.user_id])) {
        logins[l.user_id] = l.last_login_at;
      }
    });
    // A failed read leaves it unknown (null), not empty: empty would say
    // "Never logged in" about every account.
    setLastLoginSummary(loginRes.error ? null : logins);
    // Also surface failed ID upload from profiles
    profiles.forEach((p) => {
      if (p.idv_status === "failed" && p.idv_attempted_at) {
        consider(p.user_id, "Failed ID Upload", p.idv_attempted_at);
      }
    });
    setActivitySummary(summary);
  };

  const loadNotesSummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
    const { data, error } = await supabase.from("admin_user_notes")
      .select("user_id, note, created_at, category")
      .in("user_id", userIds)
      .order("created_at", { ascending: false });
    if (error) { console.error("[useAdminUserSummaries] loadNotesSummary:", error); return; }
    if (!data) return;
    const summary: Record<string, { count: number; recent: { note: string; created_at: string; category: string }[] }> = {};
    for (const row of data) {
      if (!summary[row.user_id]) summary[row.user_id] = { count: 0, recent: [] };
      summary[row.user_id].count += 1;
      if (summary[row.user_id].recent.length < 2) {
        summary[row.user_id].recent.push({ note: row.note, created_at: row.created_at, category: row.category });
      }
    }
    setNotesSummary(summary);
  };

  /**
   * Kick off all the supplemental fetches for the given users, in parallel.
   * The caller does not wait; `summariesSettled` turns true once every one has
   * settled. `profiles` is what loadActivitySummary reads for failed-ID
   * detection.
   */
  const loadSummaries = (userIds: string[], profiles: Profile[]) => {
    setSummariesSettled(false);
    void Promise.allSettled([
      loadNotesSummary(userIds),
      loadStrikesSummary(userIds),
      loadActivitySummary(userIds, profiles),
      loadPaySummary(userIds),
      loadRatingSummary(userIds),
      loadJobsCompletedSummary(userIds),
      loadOpenReportsSummary(userIds),
    ]).then(() => setSummariesSettled(true));
  };

  return {
    notesSummary,
    strikesSummary,
    lastLoginSummary,
    paySummary,
    ratingSummary,
    jobsCompletedSummary,
    openReportsSummary,
    summariesSettled,
    loadSummaries,
  };
}
