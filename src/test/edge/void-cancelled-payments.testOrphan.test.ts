/**
 * A PAID TEST-mode checkout on a cancelled + unpaid job (2026-10-13, alert
 * ledger 60298a019ea3): a release-gate journey on poster-e2e paid a sandbox
 * checkout (cs_test_b1tP3swj..., job 667fff00) and tore the job down before
 * any webhook settled it; every test-mode webhook endpoint in Stripe is
 * disabled, so nothing ever will. void-cancelled-payments counted it a defect
 * and paged it critical as "money at risk", so the cron answered 500 on EVERY
 * run, for ever, over sandbox money.
 *
 * Now: on the TEST key the sandbox payment is refunded and the job marked
 * refunded (which takes it out of the sweep's query, so it is reported once,
 * as a warning); a LIVE paid orphan keeps its critical page and its defect.
 *
 * Runs the REAL function source via the edge harness, with every Stripe call
 * recorded against the key of the client that made it.
 *
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           if (await refundTestOrphan(job, session)) testOrphansRefunded++; |           void refundTestOrphan;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         if ((e as { code?: string })?.code !== "charge_already_refunded") { |         if (true) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         .update({ payment_status: "refunded" })\n        .eq("id", job.id)\n        .eq("payment_status", "unpaid") |         .update({ payment_status: "refunded" })\n        .eq("id", job.id)
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         severity: "warning",\n        title: "TEST-mode checkout | severity: "critical",\n        title: "TEST-mode checkout
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         } else if (jobMode === "test") { |         } else if (job.stripe_session_id!.startsWith("cs_test_")) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts |           if (orphanSettlement.blocked) { |           if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts |       if (session.livemode !== false) { |       if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         if (nowErr \|\| status !== "refunded") { |         if (false) {
 * @mutate supabase/functions/void-cancelled-payments/index.ts |       const settled = (rows ?? []).length > 0; |       const settled = true;
 * @mutate supabase/functions/void-cancelled-payments/index.ts |         seed: job.is_seed === true,\n      });\n      return true; |         seed: false,\n      });\n      return true;
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

const LIVE_KEY = "sk_live_real_money";
const TEST_KEY = "sk_test_sandbox";
const CRON_SECRET = "cron-secret-orphan";
const TEST_POSTER = "11111111-1111-4111-8111-111111111111";
const REAL_POSTER = "33333333-3333-4333-8333-333333333333";
const JOB = "77777777-7777-4777-8777-777777777777";

/** One cancelled + unpaid job on `session`, posted by `poster` (enrolled as a test account when `test`). */
function seed(poster: string, session: string, test: boolean) {
  const row = { id: JOB, title: "[E2E DO NOT ACCEPT] J", stripe_session_id: session, is_seed: test };
  scenario.reads.jobs = {
    selectOverrides: [
      // jobMoneyMode's party read (readJobParties).
      { includes: "customer_id, helper_id, stripe_session_id", result: { rows: [{ customer_id: poster, helper_id: null, stripe_session_id: session }] } },
      // Part A and the D/E retry reads: nothing.
      { includes: "cancellation_fee", result: { rows: [] } },
      // Part B2 (cancelled + unpaid): the one select that names is_seed.
      { includes: "is_seed", result: { rows: [row] } },
      // Part B (open + unpaid): nothing.
      { includes: "id, title, stripe_session_id", result: { rows: [] } },
    ],
    // The conditional settle write's `.select("id")` gets the job back.
    eqOverrides: [{ column: "id", value: JOB, result: { rows: [{ id: JOB }] } }],
    rows: [],
  };
  scenario.reads.group_job_helpers = { rows: [] };
  scenario.reads.test_accounts = { rows: test ? [{ user_id: poster }] : [] };
  scenario.reads.profiles = {
    selectOverrides: [{ includes: "user_id, is_seed", result: { rows: test ? [{ user_id: poster, is_seed: true }] : [] } }],
    rows: [],
  };
  stripeMock.checkout.sessions.retrieve.mockResolvedValue({
    id: session, status: "complete", payment_status: "paid", payment_intent: "pi_paid_orphan", mode: "payment", livemode: !test,
  });
  stripeMock.refunds.create.mockResolvedValue({ id: "re_orphan", amount: 2812 });
}

async function run() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_TEST_SECRET_KEY: TEST_KEY,
    CRON_SECRET,
  });
  const fn = await loadEdgeFunction("void-cancelled-payments");
  const res = await fn.fetch(
    new Request("https://x/functions/v1/void-cancelled-payments", { method: "POST", headers: { Authorization: `Bearer ${CRON_SECRET}` } }),
  );
  return { res, body: JSON.parse(await res.text()) as Record<string, unknown> };
}

const callsOn = (key: string, method: string) => stripeMock.__calls.filter((c) => c.key === key && c.method === method);
const settleWrites = () =>
  scenario.writes.filter((w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "refunded");

describe("void-cancelled-payments: a paid TEST-mode checkout on a cancelled job (ledger 60298a019ea3)", () => {
  beforeEach(() => {
    resetEnv();
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
    stripeMock.__trackClients = true;
  });
  afterEach(() => resetEnv());

  it("refunds it on the TEST key, marks the job refunded only while still unpaid, warns once, and the run is clean (200, no defect)", async () => {
    seed(TEST_POSTER, "cs_test_orphan", true);
    const { res, body } = await run();
    expect(res.status).toBe(200);
    expect(body.defects).toBe(0);
    expect(body.test_orphans_refunded).toBe(1);
    expect(callsOn(TEST_KEY, "refunds.create")).toHaveLength(1);
    expect(callsOn(LIVE_KEY, "refunds.create")).toHaveLength(0);
    expect(callsOn(LIVE_KEY, "checkout.sessions.retrieve")).toHaveLength(0);
    const [params, opts] = stripeMock.refunds.create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(params.payment_intent).toBe("pi_paid_orphan");
    expect(opts.idempotencyKey).toBe(`test-orphan-refund:${JOB}`);
    expect(settleWrites()).toHaveLength(1);
    expect(settleWrites()[0].filters).toEqual(
      expect.arrayContaining([{ op: "eq", column: "id", value: JOB }, { op: "eq", column: "payment_status", value: "unpaid" }]),
    );
    expect(slackAlerts).toHaveLength(1);
    expect(slackAlerts[0]).toEqual(expect.objectContaining({ severity: "warning", oncePerDayKey: `test-orphan-refunded:${JOB}`, seed: true }));
  });

  it("a session that does not say livemode=false is never refunded: a defect instead", async () => {
    seed(TEST_POSTER, "cs_test_orphan", true);
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: "cs_test_orphan", status: "complete", payment_status: "paid", payment_intent: "pi_paid_orphan", mode: "payment", livemode: true,
    });
    const { body } = await run();
    expect(body.defects).toBe(1);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(settleWrites()).toHaveLength(0);
  });

  it("the job write failing after the refund is a defect, with no warning claiming it settled", async () => {
    seed(TEST_POSTER, "cs_test_orphan", true);
    scenario.writeOverrides = [{ table: "jobs", op: "update", when: (p) => p.payment_status === "refunded", error: { message: "boom" } }];
    const { body } = await run();
    expect(body.defects).toBe(1);
    expect(String((body.defectReasons as string[])[0])).toContain("job write failed");
    expect(slackAlerts).toHaveLength(0);
  });

  it("a write that matches no row (the job left 'unpaid') is a defect unless it is already refunded, and never warns", async () => {
    seed(TEST_POSTER, "cs_test_orphan", true);
    scenario.writeOverrides = [{ table: "jobs", op: "update", when: (p) => p.payment_status === "refunded", rows: [] }];
    scenario.reads.jobs!.selectOverrides!.push({ includes: "payment_status", result: { rows: [{ payment_status: "escrow" }] } });
    const escrow = await run();
    expect(escrow.body.defects).toBe(1);
    expect(String((escrow.body.defectReasons as string[])[0])).toContain("now 'escrow'");
    expect(escrow.body.test_orphans_refunded).toBe(0);
    expect(slackAlerts).toHaveLength(0);

    resetSupabaseMock(); resetStripeMock(); resetSharedMocks(); stripeMock.__trackClients = true;
    seed(TEST_POSTER, "cs_test_orphan", true);
    scenario.writeOverrides = [{ table: "jobs", op: "update", when: (p) => p.payment_status === "refunded", rows: [] }];
    scenario.reads.jobs!.selectOverrides!.push({ includes: "payment_status", result: { rows: [{ payment_status: "refunded" }] } });
    const already = await run();
    expect(already.body.defects).toBe(0);
    expect(slackAlerts).toHaveLength(0);
  });

  it("a decided, unexecuted dispute on the job holds the refund, and says so (a defect), as does a failed dispute read", async () => {
    seed(TEST_POSTER, "cs_test_orphan", true);
    scenario.reads.disputes = { rows: [{ id: "dispute-held", execution_status: "pending", payout_split: { poster: 1, helper: 0 } }] };
    const held = await run();
    expect(held.body.defects).toBe(1);
    expect(String((held.body.defectReasons as string[])[0])).toContain("held by unexecuted dispute dispute-held");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(settleWrites()).toHaveLength(0);

    resetSupabaseMock(); resetStripeMock(); resetSharedMocks(); stripeMock.__trackClients = true;
    seed(TEST_POSTER, "cs_test_orphan", true);
    scenario.reads.disputes = { error: { message: "read blew up" } };
    const unreadable = await run();
    expect(unreadable.body.defects).toBe(1);
    expect(String((unreadable.body.defectReasons as string[])[0])).toContain("read blew up");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  it("a REAL poster's cs_test_ session (mode live) is never refunded on either key", async () => {
    seed(REAL_POSTER, "cs_test_legacy", false);
    const { body } = await run();
    // It takes the LIVE orphan path: the critical page, not the test refund.
    expect(String((body.defectReasons as string[])[0])).toContain("PAID checkout the webhook never settled");
    expect(callsOn(TEST_KEY, "refunds.create")).toHaveLength(0);
    expect(callsOn(LIVE_KEY, "refunds.create")).toHaveLength(0);
    expect(settleWrites()).toHaveLength(0);
  });

  it("an earlier run's refund (charge_already_refunded) still settles the job, with no defect", async () => {
    seed(TEST_POSTER, "cs_test_orphan", true);
    stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("Charge has already been refunded."), { code: "charge_already_refunded" }));
    const { res, body } = await run();
    expect(res.status).toBe(200);
    expect(body.defects).toBe(0);
    expect(settleWrites()).toHaveLength(1);
  });

  it("any OTHER refund failure is a defect and leaves the job unpaid for the next run", async () => {
    seed(TEST_POSTER, "cs_test_orphan", true);
    stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("Stripe is down"), { type: "StripeAPIError", statusCode: 503 }));
    const { body } = await run();
    expect(body.defects).toBe(1);
    expect(String((body.defectReasons as string[])[0])).toContain("test-mode refund");
    expect(settleWrites()).toHaveLength(0);
  });

  it("control: a LIVE paid orphan is still a defect and a critical page, and nothing is refunded", async () => {
    seed(REAL_POSTER, "cs_live_orphan", false);
    const { body } = await run();
    expect(body.defects).toBe(1);
    expect(String((body.defectReasons as string[])[0])).toContain("PAID checkout the webhook never settled");
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(settleWrites()).toHaveLength(0);
    expect(slackAlerts).toEqual([expect.objectContaining({ severity: "critical", kind: "money_at_risk" })]);
  });
});
