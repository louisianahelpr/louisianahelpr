/*
 * Owner 2026-11-04: "nothing test account should show on any real admin stuff."
 *
 * adminSeedEveryView.test.ts classifies each admin VIEW by the files its rows
 * come from; a card that view mounts from a file it does not list (the Stuck
 * Jobs screen's approval escalations, the payouts screen's held-for-review
 * card, the Settings screen's shipping-claims card, the Ban Review screen's
 * ban-evasion cases, the Disputes screen's unsettled settlements) could list
 * test accounts' rows and stay green. Measured 2026-11-04 as the owner's admin
 * account (76b07824, read-only transaction): admin_stalled_job_queue returned 5
 * [E2E] jobs and get_pending_credentials 1 e2e Helpr; every admin RPC queue
 * here returns test rows unless the screen drops them.
 *
 * This guard is built from the inventory of admin READS instead: every source
 * file under src/components/admin (and the admin page) that calls
 * supabase.from(...) or supabase.rpc(...) must either drop test rows in that
 * file (the shared helpers withoutTestRows / withoutTestPeople /
 * fetchSeedUserIds, a server-side .eq("is_seed", false), or an is_seed filter)
 * or be listed below with why its reads cannot put a test row on screen. The
 * list is exact and two-way: a listed file that starts dropping test rows, or
 * stops reading, fails too, so the list never goes stale.
 *
 * @mutate src/components/admin/AdminApprovalEscalations.tsx | const rows = await withoutTestPeople((unwrap(res) ?? []) as ApprovalEscalationRow[], (r) => [r.customer_id, r.helper_id]); | const rows = (unwrap(res) ?? []) as ApprovalEscalationRow[];
 * @mutate src/components/admin/adminPayoutBatches/HeldForReview.tsx |   return withoutTestPeople(rows, (r) => [r.payee_id]); |   return rows;
 * @mutate src/components/admin/settings/DeclutterShippingClaimsCard.tsx |   rows = await withoutTestPeople(rows, (r) => [r.seller_id]); |   rows = rows;
 * @mutate src/components/admin/UnsettledSettlements.tsx | return ((unwrap(res) ?? []) as UnsettledRow[]).filter((r) => r.jobs?.is_seed !== true); | return (unwrap(res) ?? []) as UnsettledRow[];
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { readdirSync } from "@/test/helpers/trackedFiles";

const ROOT = join(__dirname, "..", "..", "..");
const A = "src/components/admin/";

/** A real read through the client. */
const READS = /supabase\s*\.\s*(?:from|rpc)\(/;
/** The row is dropped in this file before it reaches the screen. */
const DROPS = /withoutTestRows\(|withoutTestPeople\(|fetchSeedUserIds\(|realUsers\(|\.eq\("is_seed", false\)|is_seed !== true|!\w+(?:\.profiles)?\.is_seed\b|!r\.is_test\b|const showTest = false/;

/** Files that read but cannot put a test account's row on a real admin screen, and why. */
const NO_TEST_ROWS: Record<string, string> = {
  [`${A}adminAnalytics/SectionFunnel.tsx`]: "admin_section_funnel drops is_seed members on the server (20261021091636)",
  [`${A}adminAnalytics/SignupLeadsCard.tsx`]: "admin_list_signup_leads drops test data on the server (20261030015205_test_data_never_counts)",
  [`${A}adminAnalytics/SignupSources.tsx`]: "admin_signup_source_report drops is_seed members on the server (20261031220447)",
  [`${A}adminHealth/useFillRate.ts`]: "get_fill_rate_stats leaves test jobs out on the server (20261012201528_fill_rate_leaves_test_jobs_out)",
  [`${A}AdminGrowthLinks.tsx`]: "admin_booking_sources drops every test Helpr and poster on the server (20261030013347)",
  [`${A}AdminExport.tsx`]: "CSV downloads, not a screen: each row carries a Test column (adminSeedEveryView.test.ts 'export')",
  [`${A}adminDisputes/settlementEscapes.ts`]: "writes only (settle / escape RPCs on a dispute already on screen)",
  [`${A}adminJobs/EndSeriesSection.tsx`]: "acts on the one series of a job already on screen (rpc_admin_end_recurring_series)",
  [`${A}adminJobs/notifyJobParty.ts`]: "writes a notice to a party of a job already on screen",
  [`${A}adminJobs/useApplicantCounts.ts`]: "head-only counts of applications for the job ids AdminJobs already filtered",
  [`${A}adminPayoutBatches/releaseBatchJobs.ts`]: "writes only (releases a batch already on screen)",
  [`${A}adminPayoutBatches/usePayoutHolds.ts`]: "a lookup keyed by helper_id for the batches AdminPayoutBatches already filtered, plus hold writes; never rendered as its own list",
  [`${A}AdminReports.tsx`]: "status writes only; its list comes from adminReports/fetchReports.ts (drops test reporters)",
  [`${A}AdminMessageUserDialog.tsx`]: "sends a team message to the one person the admin opened",
  [`${A}AdminUserNotes.tsx`]: "notes on the one person the admin opened",
  [`${A}adminusers/useAdminUserActions.ts`]: "actions on the one person the admin opened",
  [`${A}adminusers/useOpenProfile.ts`]: "the detail of the one person the admin opened from the People list (which hides test accounts)",
  [`${A}useAdminUserSummaries.ts`]: "per-person summaries for the rows the People list already filtered",
  [`${A}userDetail/DeclutterAmountsOwed.tsx`]: "the one person the admin opened",
  [`${A}userDetail/UserAuditLog.tsx`]: "the one person the admin opened",
  [`${A}UserVerificationHistory.tsx`]: "the one person the admin opened",
  [`${A}useSupportReplies.ts`]: "replies on the one ticket the admin opened (the ticket list drops test reporters)",
  [`${A}giftCardPaidJobIds.ts`]: "a set of job ids the Analytics read intersects with its own seed-filtered jobs",
  [`${A}AdminNotifications.tsx`]: "the signed-in admin's own notification preferences",
  [`${A}AdminSettings.tsx`]: "platform settings and the admin role list; no member rows",
  [`${A}settings/FeatureSwitchesCard.tsx`]: "feature switches; no member rows",
  [`${A}settings/SmsStatusCard.tsx`]: "SMS sender status; no member rows",
  [`${A}marketing/marketingApi.ts`]: "email campaigns; no member rows",
  [`${A}BanDialog.tsx`]: "acts on the one person the admin opened (reads that person's ban settlement)",
  [`${A}RestrictApplicationsDialog.tsx`]: "acts on the one person the admin opened",
  [`${A}helprFault/BillHelprFaultButton.tsx`]: "acts on the one job already on screen",
  [`${A}helprFault/helprFault.ts`]: "acts on the one Helpr of a job already on screen",
  [`${A}adminHealth/useCronHealth.ts`]: "scheduled-job runs and system errors; no member rows",
  [`${A}adminHealth/useOpenAlerts.ts`]: "the ops alert ledger; each detector declares its own test-data policy (alertingDetectorsDeclareSeedPolicy.test.ts)",
};

function adminSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
  };
  walk("src/components/admin");
  out.push("src/pages/admin/Admin.tsx");
  return out.map((f) => relative(ROOT, join(ROOT, f)));
}

describe("owner 2026-11-04: every admin read drops test accounts' rows, or says why it cannot show one", () => {
  const files = adminSourceFiles();
  const reading = files.filter((f) => READS.test(blankComments(readFileSync(join(ROOT, f), "utf8"))));

  it("reads the admin inventory", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(reading.length).toBeGreaterThan(60);
  });

  it("every admin file that reads drops test rows, or is listed with its reason", () => {
    const missing = reading.filter((f) => !DROPS.test(blankComments(readFileSync(join(ROOT, f), "utf8"))) && !(f in NO_TEST_ROWS));
    expect(missing, "drop test rows with withoutTestPeople / withoutTestRows (src/components/admin/seedRows.ts), or list the file with its reason").toEqual([]);
  });

  it("the list is exact: each listed file still reads and still has no drop of its own", () => {
    const stale = Object.keys(NO_TEST_ROWS).filter((f) => {
      if (!reading.includes(f)) return true;
      return DROPS.test(blankComments(readFileSync(join(ROOT, f), "utf8")));
    });
    expect(stale).toEqual([]);
  });
});
