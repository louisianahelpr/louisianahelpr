/**
 * Q1909: money-reconciliation's nightly read-only check that no REAL (non-seed) row holds a Stripe TEST-mode id
 * (stripe_test_id_on_real_row, warning). Q1761 lets a test-mode event that names nobody through on the belief that only
 * test rows hold test ids; refund notices fall back to gift_cards and tips for a recipient, so a real row holding a
 * test id is a real person a sandbox event can reach.
 *
 * Measured on prod 2026-11-02 (read-only SQL, the same rule): 458 marked rows (335 jobs, 109 payment_refunds, 13
 * gift_cards, 1 tip), 0 real, 109 orphans (payment_refunds whose job and customer were deleted), so the check is
 * silent tonight and says so the day it is not.
 *
 * Runs the REAL function source through the edge harness; the unit cases pin the shared classifier.
 *
 * @mutate supabase/functions/money-reconciliation/index.ts |         checks.stripeTestIdOnRealRow.add({ |         if (false) checks.stripeTestIdOnRealRow.add({
 * @mutate supabase/functions/_shared/stripeTestIdScan.ts |   if (people.some((p) => ctx.seedPeople.has(p))) return "seed"; |   if (false) return "seed";
 * @mutate supabase/functions/_shared/stripeTestIdScan.ts |   if (job?.is_seed === true) return "seed"; |   if (false) return "seed";
 * @mutate supabase/functions/_shared/stripeTestIdScan.ts |   if (ctx.lookupFailed) return "real"; |   if (false) return "real";
 * @mutate supabase/functions/_shared/stripeTestIdScan.ts |   if (!job && people.length === 0) return "orphan"; |   if (false) return "orphan";
 * @mutate supabase/functions/_shared/stripeTestIdScan.ts |   if (typeof session === "string" && session.startsWith("cs_test_")) | if (typeof session === "string" && session.startsWith("cs_"))
 * @mutate supabase/functions/_shared/stripeTestIdScan.ts |   if (Number.isFinite(created) && created < Date.parse(STRIPE_LIVE_SINCE)) { |   if (Number.isFinite(created)) {
 * @mutate supabase/functions/money-reconciliation/index.ts |         else for (const r of ta.rows) ctx.seedPeople.add(r.user_id); |         else void ta;
 * @mutate supabase/functions/money-reconciliation/index.ts |           caps.push(`stripe test-id check: ${cap}`); |           void cap;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";
import {
  TEST_ID_TABLES,
  classifyTestIdRow,
  testIdMarker,
  testIdOrFilter,
} from "../../../supabase/functions/_shared/stripeTestIdScan";

const CRON_SECRET = "cron-secret";
const BEFORE = "2026-09-20T12:00:00Z";
const AFTER = "2026-10-20T12:00:00Z";

async function load(): Promise<EdgeHarness> {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", CRON_SECRET });
  return loadEdgeFunction("money-reconciliation");
}
async function run(fn: EdgeHarness) {
  const res = await fn.fetch(fn.request({ url: "https://edge.test/fn", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  return JSON.parse(await res.text()) as Record<string, any>;
}
const finding = (b: Record<string, any>, check: string) =>
  (b.findings as Array<{ check: string; severity: string; count: number; sample: any[] }>).find((f) => f.check === check);

/** Nothing anywhere, so only the rows a case adds can be graded. Each table's test-id read is told apart by a column
 * no other read of that table selects. */
function empty() {
  scenario.reads.jobs = { selectOverrides: [{ includes: "customer_id", result: { rows: [] } }], rows: [] };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.disputes = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  scenario.reads.test_accounts = { rows: [] };
  scenario.reads.gift_cards = { selectOverrides: [{ includes: "donor_id", result: { rows: [] } }], rows: [] };
  scenario.reads.payment_refunds = { selectOverrides: [{ includes: "stripe_refund_id", result: { rows: [] } }], rows: [] };
  scenario.reads.tips = { rows: [] };
  scenario.reads.recurring_visit_payments = { rows: [] };
}
const setOverride = (table: string, includes: string, rows: Array<Record<string, unknown>>) => {
  scenario.reads[table] = { selectOverrides: [{ includes, result: { rows } }], rows: [] };
};
const gift = (over: Record<string, unknown> = {}) => ({
  id: "gift-1", created_at: AFTER, job_id: null, donor_id: "donor-1", recipient_id: "rcpt-1",
  stripe_session_id: "cs_test_a1", stripe_payment_intent_id: null, ...over,
});

describe("money-reconciliation: a Stripe TEST-mode id on a real row (Q1909)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
  });

  it("a real gift card holding a cs_test_ session is a warning naming the row", async () => {
    const fn = await load();
    empty();
    setOverride("gift_cards", "donor_id", [gift()]);
    const b = await run(fn);
    const f = finding(b, "stripe_test_id_on_real_row");
    expect(f?.severity).toBe("warning");
    expect(f?.count).toBe(1);
    expect(f?.sample[0]).toEqual({ table: "gift_cards", row_id: "gift-1", row_job: null, marker: "cs_test_session", column: "stripe_session_id" });
    expect(b.checks_run).toContain("stripe_test_id_on_real_row");
  });

  it("every money table is read with the narrowing filter", async () => {
    const fn = await load();
    empty();
    await run(fn);
    const tables = new Set(scenario.readQueries.filter((q) => JSON.stringify(q).includes("cs_test_*") || JSON.stringify(q).includes("created_at.lt.")).map((q) => q.table));
    expect([...tables].sort()).toEqual(TEST_ID_TABLES.map((t) => t.table).sort());
    expect(tables.size).toBeGreaterThan(5);
  });

  it("the same gift from a test account (test_accounts) is seed: nothing reported", async () => {
    const fn = await load();
    empty();
    setOverride("gift_cards", "donor_id", [gift()]);
    scenario.reads.test_accounts = { rows: [{ user_id: "donor-1" }] };
    const b = await run(fn);
    expect(finding(b, "stripe_test_id_on_real_row")).toBeUndefined();
  });

  it("a recipient whose profile is is_seed is seed too", async () => {
    const fn = await load();
    empty();
    setOverride("gift_cards", "donor_id", [gift()]);
    scenario.reads.profiles = { rows: [{ user_id: "rcpt-1", is_seed: true }] };
    const b = await run(fn);
    expect(finding(b, "stripe_test_id_on_real_row")).toBeUndefined();
  });

  it("a pre-go-live refund on a real customer is reported; one naming nobody is an orphan, counted only", async () => {
    const fn = await load();
    empty();
    setOverride("payment_refunds", "stripe_refund_id", [
      { id: "ref-real", created_at: BEFORE, job_id: null, customer_id: "cust-1", stripe_payment_intent_id: "pi_old", stripe_refund_id: "re_old" },
      { id: "ref-orphan", created_at: BEFORE, job_id: null, customer_id: null, stripe_payment_intent_id: "pi_old2", stripe_refund_id: "re_old2" },
    ]);
    const b = await run(fn);
    const f = finding(b, "stripe_test_id_on_real_row");
    expect(f?.count).toBe(1);
    expect(f?.sample[0]).toMatchObject({ table: "payment_refunds", row_id: "ref-real", marker: "before_go_live", column: "stripe_payment_intent_id" });
    expect(b.scanned.stripe_test_id_orphans).toBe(1);
  });

  it("a tip on an is_seed job is seed", async () => {
    const fn = await load();
    empty();
    scenario.reads.tips = { rows: [{ id: "tip-1", created_at: AFTER, job_id: "job-s", tipper_id: "p-1", helper_id: "h-1", stripe_session_id: "cs_test_t", stripe_payment_intent_id: null }] };
    scenario.reads.jobs = {
      selectOverrides: [
        { includes: "customer_id", result: { rows: [] } },
        { includes: "id, is_seed", result: { rows: [{ id: "job-s", is_seed: true }] } },
      ],
      rows: [],
    };
    const b = await run(fn);
    expect(finding(b, "stripe_test_id_on_real_row")).toBeUndefined();
  });

  it("a live session after go-live is not a test id", async () => {
    const fn = await load();
    empty();
    setOverride("gift_cards", "donor_id", [gift({ stripe_session_id: "cs_live_a1", stripe_payment_intent_id: "pi_live" })]);
    const b = await run(fn);
    expect(finding(b, "stripe_test_id_on_real_row")).toBeUndefined();
  });

  it("a failed seed lookup reports the hit as real, and says so", async () => {
    const fn = await load();
    empty();
    setOverride("gift_cards", "donor_id", [gift()]);
    scenario.reads.test_accounts = { error: { message: "permission denied" } };
    const b = await run(fn);
    expect(finding(b, "stripe_test_id_on_real_row")?.count).toBe(1);
    expect((b.notes as string[]).some((n) => /stripe test-id check: test_accounts seed lookup failed/.test(n))).toBe(true);
  });

  it("an unreadable table is a degraded run, never a silent all-clear", async () => {
    const fn = await load();
    empty();
    scenario.reads.tips = { error: { message: "tips exploded" } };
    const b = await run(fn);
    expect((b.scan_caps as string[]).some((c) => /stripe test-id check: tips \(test ids\) read failed: tips exploded/.test(c))).toBe(true);
  });
});

describe("the shared classifier (_shared/stripeTestIdScan.ts)", () => {
  const gifts = TEST_ID_TABLES.find((t) => t.table === "gift_cards")!;
  const jobs = TEST_ID_TABLES.find((t) => t.table === "jobs")!;
  const ctx = (over: Partial<Parameters<typeof classifyTestIdRow>[2]> = {}) => ({ jobs: new Map(), seedPeople: new Set<string>(), lookupFailed: false, ...over });

  it("markers: cs_test_ any time; any Stripe id only before 2026-09-27", () => {
    expect(testIdMarker({ created_at: AFTER, stripe_session_id: "cs_test_x" }, gifts)?.marker).toBe("cs_test_session");
    expect(testIdMarker({ created_at: BEFORE, stripe_payment_intent_id: "pi_x" }, gifts)?.marker).toBe("before_go_live");
    expect(testIdMarker({ created_at: "2026-09-26T23:59:59Z", stripe_payment_intent_id: "pi_x" }, gifts)?.marker).toBe("before_go_live");
    expect(testIdMarker({ created_at: "2026-09-27T00:00:00Z", stripe_payment_intent_id: "pi_x" }, gifts)).toBeNull();
    expect(testIdMarker({ created_at: AFTER, stripe_session_id: "cs_live_x", stripe_payment_intent_id: "pi_x" }, gifts)).toBeNull();
    expect(testIdMarker({ created_at: BEFORE }, gifts)).toBeNull();
  });

  it("seed by job, by any person; orphan when nothing is named; real otherwise", () => {
    const row = { job_id: "j1", donor_id: "d1", recipient_id: null };
    expect(classifyTestIdRow(row, gifts, ctx({ jobs: new Map([["j1", { is_seed: true }]]) }))).toBe("seed");
    expect(classifyTestIdRow(row, gifts, ctx({ seedPeople: new Set(["d1"]) }))).toBe("seed");
    expect(classifyTestIdRow({ job_id: null, donor_id: null, recipient_id: null }, gifts, ctx())).toBe("orphan");
    expect(classifyTestIdRow({ job_id: "gone", donor_id: null, recipient_id: null }, gifts, ctx())).toBe("orphan");
    expect(classifyTestIdRow({ job_id: null, donor_id: null, recipient_id: null }, gifts, ctx({ lookupFailed: true }))).toBe("real");
    expect(classifyTestIdRow(row, gifts, ctx({ jobs: new Map([["j1", { is_seed: false }]]) }))).toBe("real");
    // A job row is its own job: a real ownerless job is still real.
    expect(classifyTestIdRow({ id: "j2", is_seed: false, customer_id: null, helper_id: null }, jobs, ctx())).toBe("real");
    expect(classifyTestIdRow({ id: "j2", is_seed: true }, jobs, ctx())).toBe("seed");
  });

  it("the narrowing filter covers the session and every id column", () => {
    expect(testIdOrFilter(gifts)).toBe(
      "stripe_session_id.like.cs_test_*,and(created_at.lt.2026-09-27T00:00:00Z,stripe_payment_intent_id.not.is.null),and(created_at.lt.2026-09-27T00:00:00Z,stripe_session_id.not.is.null)",
    );
    for (const t of TEST_ID_TABLES) for (const c of t.ids) expect(testIdOrFilter(t)).toContain(`${c}.not.is.null`);
  });
});
