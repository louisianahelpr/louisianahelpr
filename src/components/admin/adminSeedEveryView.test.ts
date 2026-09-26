// @mutate src/components/admin/AdminSubscriptions.tsx | {p.full_name || "No name"}{p.is_seed && <TestTag />} | {p.full_name || "No name"}
// @mutate src/components/admin/adminPayoutBatches/BatchRow.tsx | {batch.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/AdminHelperTiers.tsx | {helper.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/AdminHelperTiers.tsx | const seed = await fetchSeedUserIds(rows.map((r) => r.user_id)); | const seed = new Set<string>();
// @mutate src/components/admin/adminJobs/JobListItem.tsx | {job.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/AdminNotificationLogs.tsx | const seedIds = await fetchSeedUserIds(logRows.map((r) => r.user_id)); | const seedIds = new Set<string>();
// @mutate src/components/admin/AdminAnalytics.tsx | .select("*").eq("is_seed", false).order("created_at", { ascending: false }); | .select("*").order("created_at", { ascending: false });
// @mutate src/lib/capturedPayment.ts | !!job.stripe_payment_intent_id | true
// @mutate src/pages/admin/Admin.tsx | select("budget, platform_fee_amount, customer_fee_amount").in("payment_status", [...CAPTURED_PAYMENT_STATUSES]).not("stripe_payment_intent_id", "is", null) | select("budget, platform_fee_amount, customer_fee_amount").in("payment_status", [...CAPTURED_PAYMENT_STATUSES])
/*
 * Q233 (+ Q368, owner 2026-09-24): every admin view either FILTERS seed
 * (is_seed) rows out of its numbers or KEEPS them in its list and marks each
 * one with the shared <TestTag />. Before this, Subscriptions, Payout Batches,
 * Helpr Tiers, Jobs and eight queues listed demo accounts beside real ones with
 * nothing to tell them apart, and "Payments Collected" summed jobs that sat in
 * a held payment status with no Stripe PaymentIntent behind them.
 *
 * The inventory is the admin page's own `switch (view)`: every `case "<id>":`
 * that renders a view must have an entry below, and every entry must still be
 * a case (two-way, so a new admin screen cannot ship unclassified and a removed
 * one cannot linger). Each entry's claim is then checked against the source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { isCapturedPayment } from "@/lib/capturedPayment";

const ROOT = join(__dirname, "..", "..", "..");
const code = (rel: string) => blankComments(readFileSync(join(ROOT, rel), "utf8"));

type Rule =
  /** Lists rows and marks seed ones: every `render` file shows <TestTag />
   *  behind an is_seed (or derived is_test) check, and every `resolve` file
   *  reads is_seed: a column select, `select("*")` on profiles, or fetchSeedUserIds. */
  | { kind: "tags"; render: string[]; resolve: string[] }
  /** Aggregates only: every query in `file` excludes seed rows. */
  | { kind: "filters"; file: string }
  /** Exports: each CSV carries a Test column. */
  | { kind: "export"; file: string }
  /** Shows no row that belongs to a member account. */
  | { kind: "none"; why: string };

const A = "src/components/admin/";
const VIEWS: Record<string, Rule> = {
  analytics: { kind: "filters", file: `${A}AdminAnalytics.tsx` },
  // `select("*")` on profiles carries is_seed.
  people: { kind: "tags", render: [`${A}adminusers/AdminUserRow.tsx`], resolve: [`${A}AdminUsers.tsx`] },
  jobs: { kind: "tags", render: [`${A}adminJobs/JobListItem.tsx`], resolve: ["src/lib/jobColumns.ts"] },
  settings: { kind: "none", why: "platform_settings and the admin role list; no member rows" },
  disputes: { kind: "tags", render: [`${A}adminDisputes/DisputeCard.tsx`], resolve: [`${A}AdminDisputes.tsx`] },
  notifications: { kind: "none", why: "the signed-in admin's own notification preferences" },
  notiflogs: { kind: "tags", render: [`${A}AdminNotificationLogs.tsx`], resolve: [`${A}AdminNotificationLogs.tsx`] },
  reports: { kind: "tags", render: [`${A}AdminReports.tsx`], resolve: [`${A}AdminReports.tsx`] },
  support: { kind: "tags", render: [`${A}AdminSupport.tsx`], resolve: [`${A}AdminSupport.tsx`] },
  referrals: { kind: "tags", render: [`${A}AdminReferrals.tsx`], resolve: [`${A}AdminReferrals.tsx`] },
  subscriptions: { kind: "tags", render: [`${A}AdminSubscriptions.tsx`], resolve: [`${A}AdminSubscriptions.tsx`] },
  fraud: { kind: "tags", render: [`${A}AdminFraudDashboard.tsx`], resolve: [`${A}AdminFraudDashboard.tsx`] },
  audit: { kind: "none", why: "rows are actions taken BY admins (admin_audit_log.admin_id); the actor is never a seed member" },
  health: { kind: "none", why: "system health checks; no member rows" },
  export: { kind: "export", file: `${A}AdminExport.tsx` },
  payouts: {
    kind: "tags",
    render: [`${A}adminPayoutBatches/BatchRow.tsx`, `${A}adminPayoutBatches/LedgerList.tsx`],
    resolve: [`${A}AdminPayoutBatches.tsx`],
  },
  tiers: { kind: "tags", render: [`${A}AdminHelperTiers.tsx`], resolve: [`${A}AdminHelperTiers.tsx`] },
  idvreview: { kind: "tags", render: [`${A}AdminIDVReview.tsx`], resolve: [`${A}AdminIDVReview.tsx`] },
  credentials: { kind: "tags", render: [`${A}AdminCredentialQueue.tsx`], resolve: [`${A}AdminCredentialQueue.tsx`] },
  exceptions: { kind: "tags", render: [`${A}AdminExceptionQueue.tsx`], resolve: [`${A}AdminExceptionQueue.tsx`] },
  banreview: { kind: "tags", render: [`${A}AdminBanReview.tsx`], resolve: [`${A}AdminBanReview.tsx`] },
  stalled: { kind: "tags", render: [`${A}AdminStalledJobs.tsx`], resolve: [`${A}AdminStalledJobs.tsx`] },
  marketing: { kind: "none", why: "email campaign composer; no member rows" },
  social: { kind: "none", why: "Facebook/Instagram post queue; no member rows" },
};

/** A real read of is_seed — not merely the word in a type: a fetchSeedUserIds
 *  call, a select string naming the column, `select("*")` on profiles, or the
 *  shared job column list (which AdminJobs selects). */
const RESOLVES_SEED = /fetchSeedUserIds\(\s*\w|select\(\s*["`][^"`]*\bis_seed\b|from\("profiles"\)\s*\.select\("\*"\)|^\s*"is_seed",$/m;

/** The `case "<id>":` labels of Admin.tsx's view switch, read from source. */
function switchCases(): string[] {
  const src = code("src/pages/admin/Admin.tsx");
  const start = src.indexOf("switch (view)");
  expect(start, "Admin.tsx no longer has `switch (view)` — re-point this guard").toBeGreaterThan(-1);
  const body = src.slice(start, src.indexOf("default:", start));
  return [...body.matchAll(/case\s+"(\w+)"\s*:/g)].map((m) => m[1]);
}

describe("Q233: every admin view filters or tags seed rows", () => {
  it("the classification covers exactly the views Admin.tsx renders", () => {
    const cases = switchCases();
    expect(cases.length).toBeGreaterThan(20);
    expect([...cases].sort()).toEqual(Object.keys(VIEWS).sort());
  });

  for (const [view, rule] of Object.entries(VIEWS)) {
    if (rule.kind === "tags") {
      it(`${view}: rows wear <TestTag /> and is_seed is resolved`, () => {
        for (const f of rule.render) expect(code(f), f).toMatch(/\.is_(?:seed|test)\s*&&[^;]{0,40}?<TestTag\s*\/>/);
        for (const f of rule.resolve) expect(code(f), f).toMatch(RESOLVES_SEED);
      });
    } else if (rule.kind === "filters") {
      it(`${view}: every profiles/jobs read excludes seed rows`, () => {
        const src = code(rule.file);
        const reads = [...src.matchAll(/from\("(profiles|jobs)"\)[^;]*/g)].map((m) => m[0]);
        expect(reads.length).toBeGreaterThan(3);
        for (const r of reads) expect(r, r.slice(0, 120)).toMatch(/\.eq\("is_seed", false\)/);
      });
    } else if (rule.kind === "export") {
      it(`${view}: each CSV names its seed rows`, () => {
        const src = code(rule.file);
        const headers = [...src.matchAll(/const header\s*=\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
        expect(headers.length).toBe(3);
        for (const h of headers) expect(h.split(",").at(-1), h).toBe("Test");
        expect(src.match(/is_seed \? "yes" : "no"/g)?.length).toBe(3);
      });
    }
  }

  it("the home page counts real rows and names the seed ones beside them", () => {
    const admin = code("src/pages/admin/Admin.tsx");
    const start = admin.indexOf("const loadStats");
    const statsBody = admin.slice(start, admin.indexOf("setStats(", start));
    // One query = from `supabase.from("jobs"|"profiles")` up to the next `supabase.`.
    const reads = statsBody.split("supabase.").filter((q) => /^from\("(profiles|jobs)"\)/.test(q));
    expect(reads.length).toBeGreaterThan(10);
    for (const r of reads) expect(r, r.slice(0, 120)).toMatch(/\.eq\("is_seed", (false|true)\)/);
  });
});

describe("Q233: Payments Collected counts only charged payments", () => {
  it("a held status without a PaymentIntent is not a captured payment", () => {
    expect(isCapturedPayment({ payment_status: "escrow", stripe_payment_intent_id: "pi_1" })).toBe(true);
    expect(isCapturedPayment({ payment_status: "released", stripe_payment_intent_id: "pi_1" })).toBe(true);
    expect(isCapturedPayment({ payment_status: "escrow", stripe_payment_intent_id: null })).toBe(false);
    expect(isCapturedPayment({ payment_status: "payout_pending", stripe_payment_intent_id: "" })).toBe(false);
    expect(isCapturedPayment({ payment_status: "refunded", stripe_payment_intent_id: "pi_1" })).toBe(false);
  });

  it("every admin money read of a held status also requires the PaymentIntent", () => {
    const files = [
      "src/pages/admin/Admin.tsx",
      `${A}AdminAnalytics.tsx`,
      `${A}useAdminUserSummaries.ts`,
    ];
    let n = 0;
    for (const f of files) {
      const src = code(f);
      expect(src, `${f} hand-writes the captured-status list`).not.toMatch(/\["escrow", "payout_pending", "released"\]/);
      const HELD = '.in("payment_status", [...CAPTURED_PAYMENT_STATUSES])';
      for (let i = src.indexOf(HELD); i !== -1; i = src.indexOf(HELD, i + 1)) {
        n++;
        expect(src.slice(i + HELD.length).trimStart(), f).toMatch(/^\.not\("stripe_payment_intent_id", "is", null\)/);
      }
    }
    expect(n).toBe(7);
    const helpers = code(`${A}adminAnalytics/adminAnalyticsHelpers.ts`);
    expect(helpers).toContain("allJobs.filter(isCapturedPayment)");
    expect(helpers).not.toMatch(/capturedPaymentStatuses/);
  });
});
