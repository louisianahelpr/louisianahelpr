import { TIER_COLORS } from "../adminAnalyticsConstants";
import { netUrgentFeeDollars } from "@/lib/stripeFees";
import { HELPER_FEE_LEGACY_FALLBACK_PERCENT } from "@/lib/legacyFeeFallback";
import { SUB_PRICE, type Job, type Profile, type Tip } from "./types";
import { formatCategory } from "@/lib/format";

// Pure metric computation for the admin analytics dashboard. Extracted VERBATIM
// from AdminAnalytics.tsx — no hooks, no state, no side effects. Given the raw
// profiles / jobs / tips, returns every derived value the dashboard renders.
export const computeMetrics = (
  profiles: Profile[],
  allJobs: Job[],
  tips: Tip[],
  /** Rows from `payout_transfers` — the authoritative ledger of money that
   *  actually moved. Optional so existing callers keep working; when absent the
   *  derived estimate is used and flagged via `helperPayoutsFromLedger`. */
  payoutTransfers?: { amount_cents: number | string; status: string }[],
) => {
  // ─── Computed metrics ───
  // Unified user model: there's no helper-vs-customer distinction at the
  // user level. Define cohorts by behavior instead — anyone who's applied
  // to a job is treated as supply-side; anyone who's posted as demand-side.
  // Same user can be both.
  const helperUserIds = new Set<string>();
  for (const j of allJobs) {
    if (j.helper_id) helperUserIds.add(j.helper_id);
  }
  // also count anyone who's applied (even if never selected)
  // (allApps state isn't fetched here today — fall back to helper_id from
  //  jobs, which captures actual workers; tracking applicants would need
  //  a separate query if we want full supply-side funnel.)
  const customerUserIds = new Set<string>();
  for (const j of allJobs) {
    if (j.customer_id) customerUserIds.add(j.customer_id);
  }
  const helpers = profiles.filter(p => helperUserIds.has(p.user_id));
  const customers = profiles.filter(p => customerUserIds.has(p.user_id));

  // ─── Activation funnels ───
  // Two SaaS-standard funnels: customer-side (revenue funnel) and
  // helper-side (supply funnel). Conversion % is computed against the
  // PRIOR stage so each row reads as "of the people who hit the prior
  // milestone, what % advanced?"
  const customerJobsByUser = new Map<string, number>();
  for (const j of allJobs) {
    if (j.customer_id) {
      customerJobsByUser.set(j.customer_id, (customerJobsByUser.get(j.customer_id) ?? 0) + 1);
    }
  }
  const customersWithFirstPost = new Set(allJobs.map(j => j.customer_id).filter((x): x is string => !!x));
  const customersWithFirstAccepted = new Set(
    allJobs
      .filter(j => ["accepted", "in_progress", "completed", "revision_requested", "disputed"].includes(j.status))
      .map(j => j.customer_id)
      .filter((x): x is string => !!x),
  );
  const customersWithRepeat = new Set(
    [...customerJobsByUser.entries()].filter(([, count]) => count >= 2).map(([uid]) => uid),
  );
  // Denominator = the correct SEMANTIC prior for each row (not literally the
  // row above). A repeat poster is a subset of "Posted first job", NOT of
  // "Got first accept" — the previous denominator was firstAccepted (4)
  // while repeat-poster count is 9, rendering as 225%. Chrome-drove
  // /admin?view=analytics 2026-07-08 with 9 repeats and 4 accepts.
  const customerFunnel = [
    { label: "Signed up", count: customers.length, of: customers.length },
    { label: "Posted first job", count: customersWithFirstPost.size, of: customers.length },
    { label: "Got first accept", count: customersWithFirstAccepted.size, of: customersWithFirstPost.size || 1 },
    { label: "Repeat poster (2+)", count: customersWithRepeat.size, of: customersWithFirstPost.size || 1 },
  ];

  const helperJobsByUser = new Map<string, number>();
  for (const j of allJobs) {
    if (j.helper_id && j.status === "completed") {
      helperJobsByUser.set(j.helper_id, (helperJobsByUser.get(j.helper_id) ?? 0) + 1);
    }
  }
  const helpersApproved = helpers.filter(p => p.approval_status === "approved");
  const helpersConnectOnboarded = helpersApproved.filter(p => !!(p as { stripe_account_id?: string }).stripe_account_id);
  const helpersWithFirstJob = new Set(
    allJobs.filter(j => j.helper_id && j.status === "completed").map(j => j.helper_id).filter((x): x is string => !!x),
  );
  // Same fix as customerFunnel — a helper can complete a job without ever
  // having a stripe_account_id (legacy data, admin-elevated test accounts).
  // Denominate "Completed first job" against Approved (the actual can-work
  // milestone), not Connect onboarded. Was rendering 4/0 → 400%.
  const helperFunnel = [
    { label: "Signed up", count: helpers.length, of: helpers.length },
    { label: "Approved", count: helpersApproved.length, of: helpers.length },
    { label: "Connect onboarded", count: helpersConnectOnboarded.length, of: helpersApproved.length || 1 },
    { label: "Completed first job", count: helpersWithFirstJob.size, of: helpersApproved.length || 1 },
  ];

  // ─── Monthly signup cohorts × current activity ───
  // For each of the last 6 months of signups, what % had any job activity
  // in the last 30 days? Answers "are users from cohort X still around?"
  // — a directional retention signal that doesn't require a multi-column
  // retention matrix (which would need much larger data volumes to be
  // meaningful given current scale).
  const now = new Date();
  const monthKey = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const monthLabel = (d: Date) => d.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));
  const thirtyDaysAgoMs = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  // Active = appeared as customer_id or helper_id on any job updated in the last 30 days.
  const activeUserIds = new Set<string>();
  for (const j of allJobs) {
    const updatedAt = (j.updated_at ?? j.created_at) as string | null;
    if (!updatedAt) continue;
    if (new Date(updatedAt).getTime() < thirtyDaysAgoMs) continue;
    if (j.customer_id) activeUserIds.add(j.customer_id);
    if (j.helper_id) activeUserIds.add(j.helper_id);
  }

  const cohortMap = new Map<string, { date: Date; total: number; active: number }>();
  // Pre-seed the last 6 months so empty cohorts still appear (otherwise
  // a quiet month visually disappears, masking the dip).
  for (let i = 0; i < 6; i++) {
    const d = new Date(Date.UTC(sixMonthsAgo.getUTCFullYear(), sixMonthsAgo.getUTCMonth() + i, 1));
    cohortMap.set(monthKey(d), { date: d, total: 0, active: 0 });
  }
  for (const p of profiles) {
    if (!p.created_at) continue;
    const created = new Date(p.created_at);
    if (created < sixMonthsAgo) continue;
    const key = monthKey(created);
    const bucket = cohortMap.get(key);
    if (!bucket) continue; // older than 6 months
    bucket.total += 1;
    if (activeUserIds.has(p.user_id)) bucket.active += 1;
  }
  const cohortRetention = [...cohortMap.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  const completedJobs = allJobs.filter(j => j.status === "completed");
  // Jobs where money is actually held or paid out (NOT refunded/cancelled)
  const capturedPaymentStatuses = ["escrow", "payout_pending", "released"];
  const capturedJobs = allJobs.filter(j => capturedPaymentStatuses.includes(j.payment_status || ""));
  // Refunded jobs — money was returned, platform does NOT keep fees
  const refundedJobs = allJobs.filter(j => ["refunded"].includes(j.payment_status || ""));
  const openJobs = allJobs.filter(j => j.status === "open");
  const activeJobs = allJobs.filter(j => ["accepted", "in_progress"].includes(j.status));
  const cancelledJobs = allJobs.filter(j => j.status === "cancelled");
  const disputedJobs = allJobs.filter(j => j.status === "disputed");
  // Late cancellations where payment is still captured (not refunded)
  const lateCancelledPaidJobs = allJobs.filter(j => j.status === "cancelled" && j.late_cancellation && capturedPaymentStatuses.includes(j.payment_status || ""));

  // Gross Revenue = total amount collected via Stripe (budget + customer fee) for jobs with captured payments
  const totalRevenue = capturedJobs.reduce((s, j) => s + Number(j.budget || 0) + Number(j.customer_fee_amount || 0), 0);
  // Platform Profit = only fees from jobs where payment is still held (escrow/payout_pending/released)
  // Does NOT include refunded or cancelled-payment jobs since those fees were returned
  const totalFees = capturedJobs.reduce((s, j) => s + Number(j.customer_fee_amount || 0) + Number(j.platform_fee_amount || 0), 0);
  // Removed debug log for production submission
  // Late cancellation revenue the platform retains (cancellation fee commission)
  const lateCancelRevenue = lateCancelledPaidJobs.reduce((s, j) => {
    const cancFee = Number(j.cancellation_fee || 0);
    const commissionPercent = Number(j.helper_fee_percent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT);
    return s + (cancFee * commissionPercent / 100) + Number(j.customer_fee_amount || 0);
  }, 0);
  // HELPER PAYOUTS — read from the ledger, not recomputed from budgets.
  //
  // This used to derive it as `budget − budget × (helper_fee_percent ?? 10%)`
  // across completed jobs. Two things went wrong on live data: both completed
  // jobs carry `helper_fee_percent = NULL`, so it fell back to the legacy 10%
  // while release-payout had resolved the helper's live tier at 12%; and one of
  // those jobs has no transfer row at all yet was still counted as paid. The
  // screen reported $391.50 against $228.80 of money that actually moved — a
  // $162.70 overstatement, and a different number from Payout Batches, which
  // reads this same ledger and calls it "authoritative" in its own subtitle.
  //
  // Only SETTLED rows count; a pending or failed transfer is not money the
  // helper has.
  // `amount_cents`, not `amount` — the column is integer cents. Verified
  // against the live table before trusting it; summing a column that does not
  // exist would have silently produced 0 and looked like "no payouts yet".
  // Status is `paid` on prod today; the other two are accepted defensively.
  const ledgerPayouts = payoutTransfers
    ?.filter((t) => t.status === "paid" || t.status === "completed" || t.status === "succeeded")
    .reduce((s, t) => s + Number(t.amount_cents || 0) / 100, 0);

  // Kept for callers that do not pass the ledger — visible next to the reason
  // it is wrong, rather than deleted.
  const derivedHelperPayouts = completedJobs.reduce((s, j) => {
    const helpers = j.is_group_job && j.helpers_needed ? j.helpers_needed : 1;
    const perHelper = Number(j.budget || 0) / helpers;
    const commissionPercent = Number(j.helper_fee_percent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT);
    const commission = (perHelper * commissionPercent) / 100;
    // Urgent fee splits across the roster like the budget (#114).
    return s + (perHelper - commission + netUrgentFeeDollars(Number(j.urgent_fee ?? 0)) / helpers);
  }, 0);
  const totalHelperPayouts = ledgerPayouts ?? derivedHelperPayouts;
  /** True when the figure above came from the ledger rather than an estimate. */
  const helperPayoutsFromLedger = ledgerPayouts !== undefined;
  const totalTips = tips.filter(t => t.payment_status === "paid" || t.payment_status === "completed").reduce((s, t) => s + Number(t.amount), 0);
  const avgJobValue = capturedJobs.length > 0 ? totalRevenue / capturedJobs.length : 0;
  const completionRate = allJobs.length > 0 ? (completedJobs.length / allJobs.length) * 100 : 0;
  const cancellationRate = allJobs.length > 0 ? (cancelledJobs.length / allJobs.length) * 100 : 0;
  const totalRefunded = refundedJobs.reduce((s, j) => s + Number(j.budget || 0) + Number(j.customer_fee_amount || 0), 0);

  // Subscription breakdown
  const subBasic = helpers.filter(h => h.subscription_tier === "basic").length;
  const subPro = helpers.filter(h => h.subscription_tier === "pro").length;
  const subElite = helpers.filter(h => h.subscription_tier === "elite").length;
  const subFree = helpers.filter(h => !h.subscription_tier).length;
  // Monthly subscription revenue estimate (matches live Stripe pricing — see
  // SubscriptionTab tier list, the single source of truth for these numbers).
  const totalSubRevenue = (subBasic * SUB_PRICE.basic) + (subPro * SUB_PRICE.pro) + (subElite * SUB_PRICE.elite);

  // Category breakdown
  const categoryMap: Record<string, number> = {};
  const categoryRevenueMap: Record<string, number> = {};
  allJobs.forEach(j => {
    const cat = j.category ? formatCategory(j.category) : "other";
    categoryMap[cat] = (categoryMap[cat] || 0) + 1;
    if (j.status === "completed") {
      categoryRevenueMap[cat] = (categoryRevenueMap[cat] || 0) + (j.budget || 0);
    }
  });
  const categoryData = Object.entries(categoryMap)
    .map(([name, count]) => ({ name, count, revenue: categoryRevenueMap[name] || 0 }))
    .sort((a, b) => b.count - a.count);

  // Monthly trends (last 6 months)
  const monthlyData: { month: string; revenue: number; fees: number; jobs: number; signups: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const year = d.getFullYear();
    const month = d.getMonth();
    const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });

    const monthCaptured = capturedJobs.filter(j => {
      const jd = new Date(j.created_at);
      return jd.getFullYear() === year && jd.getMonth() === month;
    });
    const monthCompleted = completedJobs.filter(j => {
      const jd = new Date(j.created_at);
      return jd.getFullYear() === year && jd.getMonth() === month;
    });
    const monthSignups = profiles.filter(p => {
      const pd = new Date(p.created_at);
      return pd.getFullYear() === year && pd.getMonth() === month;
    });

    monthlyData.push({
      month: label,
      revenue: monthCaptured.reduce((s, j) => s + (j.budget || 0) + (j.customer_fee_amount || 0), 0),
      fees: monthCaptured.reduce((s, j) => s + (j.customer_fee_amount || 0) + (j.platform_fee_amount || 0), 0),
      jobs: monthCompleted.length,
      signups: monthSignups.length,
    });
  }

  // Payout status
  const escrowJobs = allJobs.filter(j => j.payment_status === "escrow");
  const pendingPayouts = allJobs.filter(j => j.payment_status === "payout_pending");
  const releasedPayouts = allJobs.filter(j => j.payment_status === "released");
  const escrowTotal = escrowJobs.reduce((s, j) => s + (j.budget || 0), 0);
  const pendingPayoutTotal = pendingPayouts.reduce((s, j) => {
    const helpers = j.is_group_job && j.helpers_needed ? j.helpers_needed : 1;
    const perHelper = (j.budget || 0) / helpers;
    const commissionPercent = j.helper_fee_percent ?? HELPER_FEE_LEGACY_FALLBACK_PERCENT;
    const commission = (perHelper * commissionPercent) / 100;
    // Urgent fee splits across the roster like the budget (#114).
    return s + (perHelper - commission + netUrgentFeeDollars(j.urgent_fee) / helpers);
  }, 0);

  // Subscription pie data
  const subPieData = [
    { name: "Elite", value: subElite, color: TIER_COLORS.elite },
    { name: "Pro", value: subPro, color: TIER_COLORS.pro },
    { name: "Basic", value: subBasic, color: TIER_COLORS.basic },
    { name: "Free", value: subFree, color: TIER_COLORS.free },
  ].filter(d => d.value > 0);

  // Top helpers (by completed jobs)
  const helperJobCount: Record<string, number> = {};
  completedJobs.forEach(j => {
    if (j.helper_id) helperJobCount[j.helper_id] = (helperJobCount[j.helper_id] || 0) + 1;
  });

  // User growth (approved vs pending)
  const approvedUsers = profiles.filter(p => p.approval_status === "approved").length;
  const pendingUsers = profiles.filter(p => p.approval_status === "pending").length;
  const deniedUsers = profiles.filter(p => p.approval_status === "denied").length;

  return {
    helperPayoutsFromLedger,
    helpers,
    customers,
    customerFunnel,
    helperFunnel,
    monthLabel,
    cohortRetention,
    completedJobs,
    capturedJobs,
    refundedJobs,
    openJobs,
    activeJobs,
    cancelledJobs,
    disputedJobs,
    lateCancelledPaidJobs,
    totalRevenue,
    totalFees,
    lateCancelRevenue,
    totalHelperPayouts,
    totalTips,
    avgJobValue,
    completionRate,
    cancellationRate,
    totalRefunded,
    subBasic,
    subPro,
    subElite,
    subFree,
    totalSubRevenue,
    categoryData,
    monthlyData,
    escrowJobs,
    pendingPayouts,
    releasedPayouts,
    escrowTotal,
    pendingPayoutTotal,
    subPieData,
    helperJobCount,
    approvedUsers,
    pendingUsers,
    deniedUsers,
  };
};
