// @mutate src/components/admin/AdminSubscriptions.tsx | {p.full_name \|\| "No name"}{p.is_seed && <TestTag />} | {p.full_name \|\| "No name"}
// @mutate src/components/admin/adminPayoutBatches/BatchRow.tsx | {batch.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/AdminHelperTiers.tsx | {helper.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/AdminHelperTiers.tsx | const seed = await fetchSeedUserIds(rows.map((r) => r.user_id)); | const seed = new Set<string>();
// @mutate src/components/admin/adminJobs/JobListItem.tsx | {job.is_seed && <TestTag />} | {null}
// @mutate src/components/admin/AdminNotificationLogs.tsx | const seedIds = await fetchSeedUserIds(logRows.map((r) => r.user_id)); | const seedIds = new Set<string>();
// @mutate src/components/admin/AdminAnalytics.tsx | .select(JOB_READABLE_COLUMNS).eq("is_seed", false).order("created_at", { ascending: false }); | .select(JOB_READABLE_COLUMNS).order("created_at", { ascending: false });
// @mutate src/lib/capturedPayment.ts | (!!job.stripe_payment_intent_id \|\| job.gift_card_paid === true) | true
// @mutate src/lib/capturedPayment.ts | (!!job.stripe_payment_intent_id \|\| job.gift_card_paid === true) | (!!job.stripe_payment_intent_id)
// @mutate src/lib/capturedPayment.ts | gift_card_paid: giftCardPaidJobIds.has(row.id) | gift_card_paid: false
// @mutate src/pages/admin/Admin.tsx | withGiftCardPaid(rows, giftCardPaidRes.ids).filter(isCapturedPayment) | withGiftCardPaid(rows, giftCardPaidRes.ids)
// @mutate src/pages/admin/Admin.tsx | select("id, payment_status, stripe_payment_intent_id, budget, platform_fee_amount, customer_fee_amount") | select("budget, platform_fee_amount, customer_fee_amount")
// @mutate src/components/admin/useAdminUserSummaries.ts | for (const j of withGiftCardPaid(data, giftCardPaid.ids).filter(isCapturedPayment)) { | for (const j of data) {
// @mutate src/components/admin/AdminAnalytics.tsx | setAllJobs(withGiftCardPaid(allJobsData, giftCardPaidRes.ids)); | setAllJobs(allJobsData);
// @mutate supabase/migrations/20261003050100_admin_gift_card_paid_job_ids.sql |    WHERE public.has_role((SELECT auth.uid()), 'admin'::public.app_role)\n     AND g.job_id IS NOT NULL |    WHERE g.job_id IS NOT NULL
// @mutate supabase/migrations/20261003050100_admin_gift_card_paid_job_ids.sql |      AND g.status = 'redeemed' |      AND true
// @mutate supabase/migrations/20261003050100_admin_gift_card_paid_job_ids.sql | ON FUNCTION public.admin_gift_card_paid_job_ids() FROM PUBLIC, anon; | ON FUNCTION public.admin_gift_card_paid_job_ids() FROM PUBLIC;
// @mutate supabase/migrations/20261003050100_admin_gift_card_paid_job_ids.sql | DROP FUNCTION IF EXISTS public.payment_captured(public.jobs); | SELECT 1;
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
import { isCapturedPayment, withGiftCardPaid } from "@/lib/capturedPayment";
import { newestFunction } from "@/test/helpers/parityReaders";

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
        // Exact: AdminAnalytics reads profiles once and jobs twice (2026-09-25). A new
        // read must raise this, which puts its is_seed filter in front of a reviewer.
        expect(reads.length).toBe(3);
        for (const r of reads) expect(r, r.slice(0, 120)).toMatch(/\.eq\("is_seed", false\)/);
      });
    } else if (rule.kind === "export") {
      it(`${view}: each CSV names its seed rows`, () => {
        const src = code(rule.file);
        const headers = [...src.matchAll(/const header\s*=\s*\n?\s*"([^"]+)"/g)].map((m) => m[1]);
        expect(headers.length).toBe(3);
        for (const h of headers) expect(h.split(",").pop(), h).toBe("Test");
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
    expect(reads.length).toBe(18); // exact (2026-09-25): a new stat read raises this
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

  it("Q443: a job a gift card paid in full counts as captured", () => {
    // redeem_gift_card leaves such a job in escrow with no job PI; the admin
    // reads learn which jobs those are from admin_gift_card_paid_job_ids().
    expect(isCapturedPayment({ payment_status: "escrow", stripe_payment_intent_id: null, gift_card_paid: true })).toBe(true);
    expect(isCapturedPayment({ payment_status: "escrow", stripe_payment_intent_id: null, gift_card_paid: false })).toBe(false);
    expect(isCapturedPayment({ payment_status: "refunded", stripe_payment_intent_id: null, gift_card_paid: true })).toBe(false);
    const marked = withGiftCardPaid([{ id: "job-a" }, { id: "job-b" }], new Set(["job-b"]));
    expect(marked.map((r) => r.gift_card_paid)).toEqual([false, true]);
  });

  it("Q443: admin_gift_card_paid_job_ids answers admins only, from redeemed paid gift cards", () => {
    const def = newestFunction("admin_gift_card_paid_job_ids");
    const body = def.body.replace(/\s+/g, " ");
    expect(body, def.file).toMatch(/WHERE public\.has_role\(\(SELECT auth\.uid\(\)\), 'admin'::public\.app_role\) AND g\.job_id IS NOT NULL/);
    expect(body, def.file).toMatch(/AND g\.status = 'redeemed' AND g\.payment_status = 'paid'/);
    const file = readFileSync(join(ROOT, "supabase/migrations", def.file.split("/").pop()!), "utf8");
    expect(file, def.file).toMatch(/REVOKE ALL ON FUNCTION public\.admin_gift_card_paid_job_ids\(\) FROM PUBLIC, anon;/);
    // The computed field it replaces 403'd every admin money read (a whole jobs
    // row needs offered_to_helper_id, which authenticated may not read). It
    // must stay dropped: db-smoke's rowtype-args-unreadable check is the class.
    expect(() => newestFunction("payment_captured")).toThrow(/no live definition/);
    // The Analytics page judges its loaded rows client-side, so the load marks them.
    expect(code(`${A}AdminAnalytics.tsx`)).toContain("setAllJobs(withGiftCardPaid(allJobsData, giftCardPaidRes.ids));");
  });

  it("every admin money read of a held status carries id + PI and is judged by isCapturedPayment (Q233, Q443)", () => {
    const files = [
      "src/pages/admin/Admin.tsx",
      `${A}AdminAnalytics.tsx`,
      `${A}useAdminUserSummaries.ts`,
    ];
    let n = 0;
    for (const f of files) {
      const src = code(f);
      expect(src, `${f} hand-writes the captured-status list`).not.toMatch(/\["escrow", "payout_pending", "released"\]/);
      expect(src, `${f} names the dropped computed field`).not.toMatch(/payment_captured/);
      const HELD = '.in("payment_status", [...CAPTURED_PAYMENT_STATUSES])';
      let here = 0;
      for (let i = src.indexOf(HELD); i !== -1; i = src.indexOf(HELD, i + 1)) {
        n++;
        here++;
        const sel = src.lastIndexOf(".select(", i);
        const selected = src.slice(sel, src.indexOf(")", sel) + 1);
        // JOB_READABLE_COLUMNS is every column authenticated may read, id and PI included.
        if (selected !== ".select(JOB_READABLE_COLUMNS)") {
          expect(selected, f).toMatch(/\bid\b/);
          expect(selected, f).toMatch(/\bstripe_payment_intent_id\b/);
        }
      }
      if (here > 0) {
        expect(src, f).toContain("loadGiftCardPaidJobIds()");
        expect(src, f).toMatch(/withGiftCardPaid\([^\n]*\)\.filter\(isCapturedPayment\)/);
      }
    }
    expect(n).toBe(7);
    const helpers = code(`${A}adminAnalytics/adminAnalyticsHelpers.ts`);
    expect(helpers).toContain("allJobs.filter(isCapturedPayment)");
    expect(helpers).not.toMatch(/capturedPaymentStatuses/);
  });
});
