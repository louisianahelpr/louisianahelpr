import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { helperFeePercentOrLegacy } from "@/lib/legacyFeeFallback";
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
  const [strikesSummary, setStrikesSummary] = useState<Record<string, number>>({});
  // Per-user last activity { [user_id]: { label, at } } — write-only feed
  const [, setActivitySummary] = useState<Record<string, { label: string; at: string }>>({});
  // Per-user last login time
  const [lastLoginSummary, setLastLoginSummary] = useState<Record<string, string>>({});
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
    const { data, error } = await supabase
      .from("reviews")
      .select("reviewee_id, rating")
      .in("reviewee_id", userIds);
    if (error) { console.error("[useAdminUserSummaries] loadRatingSummary:", error); return; }
    if (!data) return;
    const agg: Record<string, { sum: number; count: number }> = {};
    for (const r of data) {
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
    // Pull only completed/escrowed jobs for pay totals
    const { data, error } = await supabase
      .from("jobs")
      .select("helper_id, customer_id, budget, helper_fee_percent, customer_fee_amount, sales_tax_amount, status, payment_status")
      .or(userIds.map((id) => `helper_id.eq.${id},customer_id.eq.${id}`).join(","))
      .in("payment_status", ["escrow", "payout_pending", "released"]);
    if (error) { console.error("[useAdminUserSummaries] loadPaySummary:", error); return; }
    if (!data) return;
    const totals: Record<string, number> = {};
    for (const j of data) {
      const budget = Number(j.budget) || 0;
      if (j.helper_id && userIds.includes(j.helper_id)) {
        // `??`-semantics, not `||`: a stamped 0% (comped job) is a real fee
        // and must not be re-inflated to the legacy 10% fallback.
        const fee = helperFeePercentOrLegacy(j.helper_fee_percent) / 100;
        totals[j.helper_id] = (totals[j.helper_id] || 0) + budget * (1 - fee);
      }
      if (j.customer_id && userIds.includes(j.customer_id)) {
        totals[j.customer_id] = (totals[j.customer_id] || 0)
          + budget + (Number(j.customer_fee_amount) || 0) + (Number(j.sales_tax_amount) || 0);
      }
    }
    setPaySummary(totals);
  };

  const loadStrikesSummary = async (userIds: string[]) => {
    if (userIds.length === 0) return;
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

  const loadActivitySummary = async (userIds: string[], profiles: Profile[]) => {
    if (userIds.length === 0) return;
    const summary: Record<string, { label: string; at: string }> = {};
    // Fetch recent jobs (posted), applications (helper), and login history in parallel
    const [jobsRes, appsRes, loginRes] = await Promise.all([
      supabase.from("jobs").select("customer_id, created_at, title").in("customer_id", userIds).order("created_at", { ascending: false }).limit(500),
      supabase.from("applications").select("helper_id, created_at").in("helper_id", userIds).order("created_at", { ascending: false }).limit(500),
      supabase.from("login_history").select("user_id, created_at").in("user_id", userIds).order("created_at", { ascending: false }).limit(500),
    ]);
    if (jobsRes.error) console.error("[useAdminUserSummaries] loadActivitySummary jobs:", jobsRes.error);
    if (appsRes.error) console.error("[useAdminUserSummaries] loadActivitySummary applications:", appsRes.error);
    if (loginRes.error) console.error("[useAdminUserSummaries] loadActivitySummary loginHistory:", loginRes.error);
    const consider = (uid: string, label: string, at?: string | null) => {
      if (!at) return;
      const cur = summary[uid];
      if (!cur || new Date(at) > new Date(cur.at)) summary[uid] = { label, at };
    };
    (jobsRes.data)?.forEach((j) => consider(j.customer_id, "Posted Job", j.created_at));
    (appsRes.data)?.forEach((a) => consider(a.helper_id, "Applied to Job", a.created_at));
    (loginRes.data)?.forEach((l) => consider(l.user_id, "Logged In", l.created_at));
    // Track most-recent login separately for the user list row
    const logins: Record<string, string> = {};
    (loginRes.data)?.forEach((l) => {
      if (!logins[l.user_id] || new Date(l.created_at) > new Date(logins[l.user_id])) {
        logins[l.user_id] = l.created_at;
      }
    });
    setLastLoginSummary(logins);
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
   * Kick off all the supplemental fetches for the given users. Fire-and-
   * forget, in parallel — matches the previous inline behaviour. `profiles`
   * is what loadActivitySummary reads for failed-ID detection.
   */
  const loadSummaries = (userIds: string[], profiles: Profile[]) => {
    loadNotesSummary(userIds);
    loadStrikesSummary(userIds);
    loadActivitySummary(userIds, profiles);
    loadPaySummary(userIds);
    loadRatingSummary(userIds);
    loadJobsCompletedSummary(userIds);
    loadOpenReportsSummary(userIds);
  };

  return {
    notesSummary,
    strikesSummary,
    lastLoginSummary,
    paySummary,
    ratingSummary,
    jobsCompletedSummary,
    openReportsSummary,
    loadSummaries,
  };
}
