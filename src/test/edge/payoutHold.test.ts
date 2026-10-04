/**
 * Q764: a payout hold stored in the database stops the payout paths.
 *
 * Before 20261004162921 the hold lived in one admin's browser and no server
 * path read it: a second admin's Send Payout, Bulk Approve (both via
 * release-payout), the scheduled crons and the Helpr's own cash-outs all paid a
 * "held" Helpr. Every case below seeds `payout_holds` and asserts no money
 * moved; on main (no hold check anywhere) each "held" case pays and fails.
 *
 * The Supabase mock hands back seeded rows whatever the filter, so the module
 * (_shared/payoutHold.ts, the REAL one, see harness.ts) keys holds by
 * helper_id itself, and "a hold on someone else" is pinned below too.
 *
 * Every path is ALSO required, by source scan, to check the hold before its
 * money call (src/test/payoutPathsHonourHold.test.ts); this file is the
 * behaviour of the ones a hold most often meets.
 *
 * @mutate supabase/functions/release-payout/index.ts |   if (hold.kind === "held") {\n    console.warn(`[release-payout] | if (false) {\n    console.warn(`[release-payout]
 * @mutate supabase/functions/release-payout/index.ts |   if (hold.kind === "error") {\n    console.error(`[release-payout] payout hold | if (false) {\n    console.error(`[release-payout] payout hold
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       if (hold.kind === "held") { |       if (false) {
 * @mutate supabase/functions/auto-release-payment/index.ts |         if (holdLookup.ok && job.helper_id && holdLookup.holds.has(job.helper_id)) { |         if (false) {
 * @mutate supabase/functions/auto-release-payment/index.ts |           } else if (json.code === PAYOUT_HELD_CODE) { |           } else if (false) {
 * @mutate supabase/functions/auto-release-payment/index.ts |       for (const job of holdLookup.ok ? dueJobs ?? [] : []) { |       for (const job of dueJobs ?? []) {
 * @mutate supabase/functions/_shared/payoutHold.ts |     if (row && ids.includes(row.helper_id)) holds.set(row.helper_id, row); |     if (row) holds.set(ids[0], row);
 * @mutate supabase/functions/_shared/payoutHold.ts |     if (tableMissing(error)) return { ok: true, holds }; |     if (tableMissing(error)) return { ok: false, message: "missing" };
 * @mutate supabase/functions/cash-out-credits/index.ts |     if (hold.kind === "held") { |     if (false) {
 * @mutate supabase/functions/create-payment/index.ts |       if (tipHold.kind === "held") { |       if (false) {
 * @mutate supabase/functions/auto-tip-charge/index.ts |       if (tipHold.kind === "held") { |       if (false) {
 * @mutate supabase/functions/instant-payout/index.ts |     if (hold.kind === "held") { |     if (false) {
 * @mutate supabase/functions/release-payout/index.ts |   if (claim.kind === "error" && isPayoutHeldRefusal(claim.message)) { |   if (false) {
 * @mutate supabase/functions/process-scheduled-payouts/index.ts |       if (claim.kind === "error" && isPayoutHeldRefusal(claim.message)) { |       if (false) {
 * @mutate supabase/functions/_shared/payoutHold.ts |   return !!message && /\bpayout_held\b/.test(message); |   return !!message;
 * @mutate supabase/functions/money-reconciliation/index.ts |       if (heldJobIds.has(job.id as string)) continue; |       void heldJobIds;
 * @mutate supabase/functions/money-reconciliation/index.ts |         notes.push(`payout hold read failed, no held payout exempted: ${holdLookup.message}`); |         void holdLookup;
 * @mutate supabase/functions/money-reconciliation/index.ts |       for (const r of pendingRoster.rows) { |       for (const r of [] as typeof pendingRoster.rows) {
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "cron-secret-q764";
const HELD = { helper_id: "helper-1", reason: "fraud review", held_at: "2026-10-03T00:00:00Z", denied_at: null };
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const ledgerInserts = () => scenario.writes.filter((w) => w.table === "payout_transfers" && w.op === "insert");

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── release-payout: admin Send Payout, Bulk Approve, auto-release Phase 2 ──
describe("release-payout honours the payout hold", () => {
  const capturedCents = (budget: number) => Math.round(budget * 100 * 1.12);

  function seedPayable(s: SupabaseScenario) {
    const budget = 100;
    s.reads.jobs = {
      rows: [{
        id: "job-1", title: "Mow", status: "completed", payment_status: "payout_pending",
        helper_id: "helper-1", customer_id: "poster-1", budget, urgent_fee: 0,
        dispute_status: null, disputed_at: null, is_group_job: false, helpers_needed: null,
        stripe_payment_intent_id: "pi_1", stripe_session_id: null,
      }],
    };
    s.reads.gift_cards = { rows: [] };
    s.reads.disputes = { rows: [] };
    s.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", full_name: "H", onboarding_fee_paid: true }] };
    s.reads.platform_settings = { rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
    s.reads.payout_transfers = { rows: [] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", amount: capturedCents(budget), amount_received: capturedCents(budget),
    });
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true });
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_1", transfer_group: "job_job-1" });
  }

  async function call() {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET,
    });
    const fn = await loadEdgeFunction("release-payout");
    return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: { job_id: "job-1" } }));
  }

  it("refuses a held Helpr with code payout_held, before any Stripe call or claim", async () => {
    seedPayable(scenario);
    scenario.reads.payout_holds = { rows: [HELD] };
    const res = await call();
    expect(res.status).toBe(409);
    const body = await json(res);
    expect(body.code).toBe("payout_held");
    expect(body.hold_reason).toBe("fraud review");
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(ledgerInserts()).toHaveLength(0);
    // The hold read asked for THIS helper.
    const q = scenario.readQueries.find((r) => r.table === "payout_holds");
    expect(q?.filters).toContainEqual({ op: "in", column: "helper_id", value: ["helper-1"] });
  });

  it("a recorded denial still blocks", async () => {
    seedPayable(scenario);
    scenario.reads.payout_holds = { rows: [{ ...HELD, denied_at: "2026-10-03T01:00:00Z" }] };
    const res = await call();
    expect(res.status).toBe(409);
    expect((await json(res)).denied).toBe(true);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("FAILS CLOSED when the hold cannot be read", async () => {
    seedPayable(scenario);
    scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
    const res = await call();
    expect(res.status).toBe(500);
    expect((await json(res)).error).toMatch(/payout hold check failed/);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("pays when nobody is held, when someone ELSE is held, and when the table is not deployed (42P01)", async () => {
    for (const holds of [
      { rows: [] },
      { rows: [{ ...HELD, helper_id: "helper-2" }] },
      { error: { message: 'relation "public.payout_holds" does not exist', code: "42P01" } },
    ]) {
      resetStripeMock();
      resetSupabaseMock();
      seedPayable(scenario);
      scenario.reads.payout_holds = holds;
      const res = await call();
      expect(res.status, JSON.stringify(holds)).toBe(200);
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    }
  });

  it("a hold that lands between the check and the claim (the trigger's 23514 payout_held) answers 409 payout_held, not 500", async () => {
    seedPayable(scenario);
    scenario.reads.payout_holds = { rows: [] };
    scenario.writeErrors.payout_transfers = { message: "payout_held", code: "23514" };
    const res = await call();
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("payout_held");
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("any OTHER claim failure is still a 500 with no code", async () => {
    seedPayable(scenario);
    scenario.reads.payout_holds = { rows: [] };
    scenario.writeErrors.payout_transfers = { message: "connection reset", code: "08006" };
    const res = await call();
    expect(res.status).toBe(500);
    expect((await json(res)).code).toBeUndefined();
  });
});

// ── process-scheduled-payouts: the scheduled cron ──────────────────────────
describe("process-scheduled-payouts honours the payout hold", () => {
  function seed(s: SupabaseScenario) {
    const job = {
      id: "job-1", title: "Mow", helper_id: "helper-1", customer_id: "poster-1", budget: 100,
      platform_fee_amount: 10, helper_fee_percent: 10, urgent_fee: 0, stripe_session_id: "cs_1",
      stripe_payment_intent_id: "pi_1", status: "completed", payment_status: "payout_pending", is_group_job: false, helpers_needed: 1, sales_tax_rate: 0,
    };
    s.reads.jobs = { rows: [job] };
    s.reads.platform_settings = { rows: [{ onboarding_fee_cents: 200 }] };
    s.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", onboarding_fee_paid: true, subscription_tier: "pro", subscription_expires_at: null }] };
    s.reads.payout_transfers = { rows: [] };
    s.reads.user_roles = { rows: [] };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1", status: "succeeded", latest_charge: "ch_1", amount: 11200, amount_received: 11200,
    });
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_1" });
  }
  async function run() {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET,
    });
    const fn = await loadEdgeFunction("process-scheduled-payouts");
    return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
  }

  it("skips a held Helpr as an outcome: no transfer, no claim, not a defect", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [HELD] };
    const res = await run();
    const body = await json(res);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(ledgerInserts()).toHaveLength(0);
    expect((body.results as Array<{ status: string }>).map((r) => r.status)).toEqual(["payout_held"]);
    expect(res.status).toBe(200);
    expect(body.defects).toBe(0);
    // The job is not flipped: it stays payout_pending for the run after release.
    expect(scenario.writes.some((w) => w.table === "jobs" && w.op === "update")).toBe(false);
  });

  it("an unreadable hold is a defect and pays nobody", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { error: { message: "timeout", code: "57014" } };
    const res = await run();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("pays an unheld Helpr", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [] };
    await run();
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
  });

  it("a hold that lands between the check and the claim is an outcome, not a defect", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [] };
    scenario.writeErrors.payout_transfers = { message: "payout_held", code: "23514" };
    const res = await run();
    const body = await json(res);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect((body.results as Array<{ status: string }>).map((r) => r.status)).toEqual(["payout_held"]);
    expect(res.status).toBe(200);
  });
});

// ── money-reconciliation: a held payout is not a stranded one ──────────────
describe("money-reconciliation does not page on a payout a hold keeps back", () => {
  const overdue = new Date(Date.now() - 3 * 86_400_000).toISOString();
  function seed(s: SupabaseScenario) {
    s.reads.jobs = {
      rows: [{
        id: "job-1", is_seed: false, status: "completed", payment_status: "payout_pending", budget: 100,
        date_needed: overdue, cancelled_at: null, helper_id: "helper-1", helper_confirmed_at: overdue,
        cancellation_fee: 0, cancellation_fee_status: null, late_cancellation: false, platform_fee_amount: 12,
        helper_fee_percent: 12, is_group_job: false, helpers_needed: 1, has_active_dispute: false,
        dispute_status: null, poster_completed_at: overdue, helper_completed_at: overdue,
        payout_scheduled_at: overdue, updated_at: overdue,
      }],
    };
    s.reads.payout_transfers = { rows: [] };
    s.reads.disputes = { rows: [] };
    s.reads.profiles = { rows: [] };
    s.reads.gift_cards = { rows: [] };
  }
  async function run() {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_x", CRON_SECRET,
    });
    const fn = await loadEdgeFunction("money-reconciliation");
    return fn.fetch(fn.request({ url: "https://edge.test/fn", headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  }
  const checks = (b: Record<string, unknown>) => (b.findings as Array<{ check: string }>).map((f) => f.check);

  it("an UNHELD overdue payout_pending job is stranded (critical)", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [] };
    const b = await json(await run());
    expect(checks(b)).toContain("payout_pending_stranded");
    expect(b.payout_pending_held).toEqual([]);
  });

  it("a HELD Helpr's job is reported in payout_pending_held and does not page as stranded", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [HELD] };
    const res = await run();
    const b = await json(res);
    expect(checks(b)).not.toContain("payout_pending_stranded");
    expect(b.payout_pending_held).toEqual([{ job_id: "job-1", helper_ids: ["helper-1"] }]);
    expect(((b.defectReasons as string[] | undefined) ?? []).join(" ")).not.toContain("payout_pending_stranded");
  });

  it("a crew job is held when every UNPAID roster member is held", async () => {
    seed(scenario);
    scenario.reads.jobs!.rows![0] = { ...scenario.reads.jobs!.rows![0], is_group_job: true, helpers_needed: 2, helper_id: null };
    scenario.reads.group_job_helpers = { rows: [{ id: "g1", job_id: "job-1", helper_id: "helper-2" }, { id: "g2", job_id: "job-1", helper_id: "helper-1" }] };
    // helper-2 was paid; only the held helper-1 is still owed.
    scenario.reads.payout_transfers = {
      rows: [{ job_id: "job-1", helper_id: "helper-2", amount_cents: 4400, platform_fee_cents: 600, status: "paid", stripe_transfer_id: "tr_2" }],
    };
    scenario.reads.payout_holds = { rows: [HELD] };
    const b = await json(await run());
    expect(checks(b)).not.toContain("payout_pending_stranded");
    expect(b.payout_pending_held).toEqual([{ job_id: "job-1", helper_ids: ["helper-1"] }]);
  });

  // Q1240: one held member used to exempt the WHOLE crew job, so an unheld
  // member whose leg was stuck (no Connect account, no PaymentIntent, an
  // orphaned claim) was silent for as long as the other's hold lasted.
  // @mutate supabase/functions/money-reconciliation/index.ts | if (unpaidHeld.length > 0 && unpaidHeld.length === unpaid.length) { | if (held.length) {
  it("Q1240: a held member does not hide an UNHELD member who is still unpaid", async () => {
    seed(scenario);
    scenario.reads.jobs!.rows![0] = { ...scenario.reads.jobs!.rows![0], is_group_job: true, helpers_needed: 2, helper_id: null };
    scenario.reads.group_job_helpers = { rows: [{ id: "g1", job_id: "job-1", helper_id: "helper-2" }, { id: "g2", job_id: "job-1", helper_id: "helper-1" }] };
    // helper-2 is NOT held and was never paid (a claim that moved nothing).
    scenario.reads.payout_transfers = {
      rows: [{ job_id: "job-1", helper_id: "helper-2", amount_cents: 4400, platform_fee_cents: 600, status: "pending", stripe_transfer_id: null }],
    };
    scenario.reads.payout_holds = { rows: [HELD] };
    const b = await json(await run());
    expect(checks(b)).toContain("payout_pending_stranded");
    expect(b.payout_pending_held).toEqual([]);
  });

  // @mutate supabase/functions/money-reconciliation/index.ts | if (unpaidHeld.length > 0 && unpaidHeld.length === unpaid.length) { | if (held.length && unpaidHeld.length === unpaid.length) {
  it("Q1240: a crew whose members were ALL paid but never flipped is stranded, even with a held member", async () => {
    seed(scenario);
    scenario.reads.jobs!.rows![0] = { ...scenario.reads.jobs!.rows![0], is_group_job: true, helpers_needed: 2, helper_id: null };
    scenario.reads.group_job_helpers = { rows: [{ id: "g1", job_id: "job-1", helper_id: "helper-2" }, { id: "g2", job_id: "job-1", helper_id: "helper-1" }] };
    scenario.reads.payout_transfers = {
      rows: [
        { job_id: "job-1", helper_id: "helper-1", amount_cents: 4400, platform_fee_cents: 600, status: "paid", stripe_transfer_id: "tr_1" },
        { job_id: "job-1", helper_id: "helper-2", amount_cents: 4400, platform_fee_cents: 600, status: "paid", stripe_transfer_id: "tr_2" },
      ],
    };
    scenario.reads.payout_holds = { rows: [HELD] };
    const b = await json(await run());
    expect(checks(b)).toContain("payout_pending_stranded");
    expect(b.payout_pending_held).toEqual([]);
  });

  it("FAILS CLOSED: an unreadable hold exempts nothing, and the run is degraded", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
    const res = await run();
    const b = await json(res);
    expect(checks(b)).toContain("payout_pending_stranded");
    expect(res.status).toBe(500);
    expect((b.notes as string[]).join(" ")).toContain("payout hold read failed");
  });
});

// ── auto-release-payment Phase 2: hands matured payouts to release-payout ──
describe("auto-release-payment honours the payout hold", () => {
  function seed(s: SupabaseScenario) {
    s.reads.jobs = {
      rows: [],
      selectOverrides: [{
        includes: "payout_scheduled_at",
        result: {
          rows: [{
            id: "job-p", title: "Paint fence", helper_id: "helper-1", budget: 100, urgent_fee: 0,
            is_group_job: false, helpers_needed: 1, payout_scheduled_at: new Date(0).toISOString(), is_seed: false,
          }],
        },
      }],
    };
    s.reads.profiles = { rows: [] };
    s.reads.gift_cards = { rows: [] };
    s.reads.payout_transfers = { rows: [] };
  }
  async function run() {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET, RELEASE_PAYOUT_AUTO: "1",
    });
    const fn = await loadEdgeFunction("auto-release-payment");
    return fn.fetch(fn.request({ method: "POST", url: "https://edge.test/auto-release-payment", headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
  }
  const failedAttempts = () =>
    ledgerInserts().filter((w) => (w.payload as { status?: string }).status === "failed");

  it("does not hand a held Helpr's job to release-payout, records no failed attempt, does not page", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [HELD] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, stripe_transfer_id: "tr_x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await run();
    const body = await json(res);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.paid).toBe(0);
    expect((body.payoutResults as Array<{ status: string }>)[0].status).toBe("payout_held");
    expect(failedAttempts()).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it("a hold that lands after the read (release-payout answers payout_held) is not a failed attempt", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [] };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "on hold", code: "payout_held" }), { status: 409 })));
    const res = await run();
    const body = await json(res);
    expect((body.payoutResults as Array<{ status: string }>)[0].status).toBe("payout_held");
    expect(failedAttempts()).toHaveLength(0);
    expect(res.status).toBe(200);
  });

  it("an unreadable hold attempts NO payout this run and is a defect", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await run();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.status).toBe(500);
  });

  it("an unheld Helpr's matured payout is handed to release-payout", async () => {
    seed(scenario);
    scenario.reads.payout_holds = { rows: [] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, stripe_transfer_id: "tr_x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const body = await json(await run());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(body.paid).toBe(1);
  });
});

// ── The Helpr's own money-out paths ────────────────────────────────────────
describe("cash-out-credits honours the payout hold", () => {
  it("refuses before claiming any credit or calling Stripe", async () => {
    setEnv({
      SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
      SECRET_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_cashout",
    });
    const fn = await loadEdgeFunction("cash-out-credits");
    scenario.authUser = { id: "helper-1", email: "h@example.com" };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.writeSelectRows["referral_credits:update"] = [{ id: "c1", amount: 5 }];
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_ok" });
    scenario.reads.payout_holds = { rows: [HELD] };
    const res = await fn.fetch(fn.request({
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer caller.jwt.sig" },
      body: { attemptId: "11111111-2222-4333-8444-555555555555" },
    }));
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("payout_held");
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "referral_credits")).toBe(false);
  });
});

describe("instant-payout honours the payout hold", () => {
  it("refuses quote and execute alike, with no Stripe call", async () => {
    setEnv({
      SUPABASE_URL: "https://project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
      SECRET_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_instant",
    });
    scenario.authUser = { id: "helper-1", email: "h@example.com" };
    scenario.reads.profiles = {
      rows: [{ stripe_account_id: "acct_helper", full_name: "H", subscription_tier: "basic", subscription_expires_at: null }],
    };
    scenario.reads.payout_holds = { rows: [HELD] };
    stripeMock.balance.retrieve.mockResolvedValue({ instant_available: [{ currency: "usd", amount: 10_000 }] });
    const fn = await loadEdgeFunction("instant-payout");
    for (const action of ["quote", "execute"]) {
      const res = await fn.fetch(fn.request({
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer caller.jwt.sig" },
        body: { action },
      }));
      expect(res.status, action).toBe(409);
    }
    expect(stripeMock.payouts.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.balance.retrieve).not.toHaveBeenCalled();
  });
});

// ── Tips: destination charges, so the money reaches the Helpr as it is paid ─
describe("tips honour the payout hold", () => {
  it("create-payment opens no tip checkout for a held Helpr", async () => {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc123",
    });
    scenario.authUser = { id: "poster-1", email: "poster@test.com" };
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    scenario.reads.jobs = {
      rows: [{ id: "job-1", customer_id: "poster-1", helper_id: "helper-1", status: "completed", title: "Mow lawn" }],
    };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.reads.payout_holds = { rows: [HELD] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_tip", url: "https://checkout.stripe.test/tip" });
    const fn = await loadEdgeFunction("create-payment");
    const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body: { action: "tip", jobId: "job-1", amount: 15 } }));
    expect(res.status).toBe(409);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "tips")).toBe(false);
  });

  it("auto-tip-charge neither claims nor charges a held Helpr's tip", async () => {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET,
    });
    const fn = await loadEdgeFunction("auto-tip-charge");
    scenario.rpc.auto_tip_candidates = [
      { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10 },
    ];
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.reads.payout_holds = { rows: [HELD] };
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
    stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_1" }] });
    stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_auto_1", status: "succeeded" });
    const res = await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    expect(scenario.writes.some((w) => w.table === "tips")).toBe(false);
    expect(res.status).toBe(200);
  });

  // Q1224: auto_tip_candidates offers a job for 14 days; a hold longer than
  // that dropped the tip with nobody told. On the window's last day it is
  // recorded (a 'failed' auto row) and the poster is told; nothing is charged.
  describe("Q1224 an auto-tip whose window closes under a hold", () => {
    async function runHeldTip(completedDaysAgo: number) {
      setEnv({
        SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
        STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET,
      });
      const fn = await loadEdgeFunction("auto-tip-charge");
      scenario.rpc.auto_tip_candidates = [
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 10 },
      ];
      scenario.reads.jobs = { rows: [{ id: "job-1", completed_at: new Date(Date.now() - completedDaysAgo * 86_400_000).toISOString() }] };
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      scenario.reads.payout_holds = { rows: [HELD] };
      return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
    }

    // @mutate supabase/functions/auto-tip-charge/index.ts | if (!Number.isFinite(completedMs) \|\| Date.now() - completedMs < AUTO_TIP_HELD_RECORD_AFTER_MS) continue; | continue;
    it("on the last day: records a 'failed' auto tip and tells the poster, charging nothing", async () => {
      const res = await runHeldTip(13.5);
      expect(res.status).toBe(200);
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      const tip = scenario.writes.find((w) => w.table === "tips" && w.op === "insert");
      expect(tip?.payload).toMatchObject({ job_id: "job-1", source: "auto", payment_status: "failed" });
      const note = scenario.writes.find((w) => w.table === "notifications");
      expect(note?.payload).toMatchObject({ user_id: "poster-1", title: "Your automatic tip wasn't sent" });
    });

    // Review of Q1224 (should-fix): a crew job has one candidate per member;
    // the poster gets ONE notice for the job, and it names the job.
    // @mutate supabase/functions/auto-tip-charge/index.ts |         if (agedOutNotified.has(jobId)) continue; |
    it("a crew job with two held members: two recorded tips, ONE notice carrying job_id", async () => {
      setEnv({
        SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key",
        STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET,
      });
      const fn = await loadEdgeFunction("auto-tip-charge");
      scenario.rpc.auto_tip_candidates = [
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-1", budget: 100, tip_amount: 5 },
        { job_id: "job-1", customer_id: "poster-1", helper_id: "helper-2", budget: 100, tip_amount: 5 },
      ];
      scenario.reads.jobs = { rows: [{ id: "job-1", completed_at: new Date(Date.now() - 13.5 * 86_400_000).toISOString() }] };
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
      scenario.reads.payout_holds = { rows: [HELD, { ...HELD, helper_id: "helper-2" }] };
      await fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
      expect(scenario.writes.filter((w) => w.table === "tips" && w.op === "insert")).toHaveLength(2);
      const notes = scenario.writes.filter((w) => w.table === "notifications").map((w) => w.payload as Record<string, unknown>);
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ user_id: "poster-1", job_id: "job-1" });
    });

    // @mutate supabase/functions/auto-tip-charge/index.ts | const AUTO_TIP_HELD_RECORD_AFTER_MS = 13 * 24 * 60 * 60 * 1000; | const AUTO_TIP_HELD_RECORD_AFTER_MS = 0;
    it("earlier in the window: still waits for the hold, writes nothing", async () => {
      const res = await runHeldTip(2);
      expect(res.status).toBe(200);
      expect(scenario.writes.some((w) => w.table === "tips" || w.table === "notifications")).toBe(false);
    });
  });
});
