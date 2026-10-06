/**
 * Q1221: payout-hold-stripe-sync, the edge function that tells Stripe about a
 * payout hold. Runs the REAL source through the edge harness with a FAKE
 * Stripe client (src/test/edge/mocks/stripe.ts): no real connected account's
 * schedule is changed by this file.
 *
 *   - only the service key / CRON_SECRET or an ADMIN may call it;
 *   - a hold sets settings.payouts.schedule.interval = manual on the Helpr's
 *     Connect account (and a release puts the saved schedule back), through
 *     the state machine pinned by src/test/payoutFreeze.test.ts;
 *   - a failure pages ops critical and, on a request's first failed attempt,
 *     leaves a note on the Helpr's admin page from the admin who asked;
 *   - a service call with no helper_id settles every open request.
 *
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts | if (isAdmin !== true) return json({ error: "admin role required" }, 403); |
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts | if (outcome.kind === "failed") await reportFailure(supabaseAdmin, id, outcome); |
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts | if (outcome.attempts === 1 && outcome.requestedBy) { | if (false) {
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts | { settings: { payouts: { schedule } } } as never, | { settings: {} } as never,
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts | .in("freeze_state", ["pause_requested", "restore_requested"]) | .in("freeze_state", ["pause_requested"])
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts | if (outcome.kind === "paused" && outcome.drifted) { | if (false) {
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts |       if (now?.state === "paused") { |       if (false) {
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts |       .eq("freeze_state", "paused")\n      .or( |       .eq("freeze_state", "never")\n      .or(
 * @mutate supabase/functions/payout-hold-stripe-sync/index.ts |   if (adminId && helperId) {\n    await writeAdminAudit( |   if (false) {\n    await writeAdminAudit(
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

const HELPR = "bbbbbbbb-0000-4000-8000-000000000002";
const ADMIN = { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "admin-q1221@example.test" };
const ACCT = "acct_q1221";
const SERVICE = "service-key-q1221";
type Alert = { kind?: string; severity?: string; title: string; fields?: Record<string, unknown> };
const alerts = () => slackAlerts as Alert[];
const notes = () => scenario.writes.filter((w) => w.table === "admin_user_notes" && w.op === "insert");
const freezeRow = (over: Record<string, unknown> = {}) => ({
  helper_id: HELPR,
  freeze_state: "pause_requested",
  stripe_account_id: null,
  prior_schedule: null,
  requested_by: ADMIN.id,
  requested_at: "2026-10-05T21:00:00.000Z",
  attempts: 0,
  ...over,
});

async function call(auth: string, body: Record<string, unknown> | null) {
  const fn = await loadEdgeFunction("payout-hold-stripe-sync");
  return fn.fetch(fn.request({ headers: { Authorization: auth }, ...(body ? { body } : { rawBody: "" }) }));
}
const bodyOf = async (res: Response) => JSON.parse(await res.text());

describe("Q1221 — payout-hold-stripe-sync", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      STRIPE_SECRET_KEY: "sk_test_q1221",
    });
    scenario.reads.payout_schedule_freezes = {
      rows: [freezeRow()],
      selectOverrides: [{ includes: "freeze_error", result: { rows: [{ attempts: 0, freeze_error: null }] } }],
    };
    // The table is stateful for the row the function writes: the schedule it
    // saves is what its re-read sees (it never sets manual before that).
    scenario.writeOverrides = [{
      table: "payout_schedule_freezes",
      op: "update",
      when: (payload) => {
        const rows = scenario.reads.payout_schedule_freezes.rows ?? [];
        if (rows[0] && "prior_schedule" in payload) rows[0] = { ...rows[0], ...payload };
        return false;
      },
    }];
    scenario.reads.profiles = { rows: [{ stripe_account_id: ACCT }] };
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ACCT, settings: { payouts: { schedule: { interval: "daily", delay_days: 2 } } } });
    stripeMock.accounts.update.mockResolvedValue({ id: ACCT });
  });
  afterEach(() => resetEnv());

  it("an admin's hold sets the Helpr's Connect payouts to manual and records the pause", async () => {
    scenario.authUser = ADMIN;
    scenario.rpc.has_role = true;

    const res = await call("Bearer admin-jwt", { helper_id: HELPR });

    expect(res.status).toBe(200);
    expect((await bodyOf(res)).ok).toBe(true);
    expect(stripeMock.accounts.update).toHaveBeenCalledTimes(1);
    const [acct, params, opts] = stripeMock.accounts.update.mock.calls[0];
    expect(acct).toBe(ACCT);
    expect(params).toEqual({ settings: { payouts: { schedule: { interval: "manual" } } } });
    expect(opts.idempotencyKey).toContain(HELPR);
    const writes = scenario.writes.filter((w) => w.table === "payout_schedule_freezes" && w.op === "update");
    // savePrior (the daily schedule, BEFORE Stripe was touched) then the CAS to paused.
    expect(writes[0].payload).toMatchObject({ prior_schedule: { interval: "daily", delay_days: 2 }, stripe_account_id: ACCT });
    expect(writes[1].payload).toMatchObject({ freeze_state: "paused" });
    expect(writes[1].filters).toContainEqual({ op: "eq", column: "freeze_state", value: "pause_requested" });
    // The admin's call is audited (who told Stripe what, for whom).
    const audit = scenario.writes.find((w) => w.table === "admin_audit_log" && w.op === "insert");
    expect(audit?.payload).toMatchObject({ admin_id: ADMIN.id, action: "payout_hold_stripe_sync", target_id: HELPR, target_type: "user" });
  });

  it("a release puts the saved schedule back", async () => {
    scenario.reads.payout_schedule_freezes.rows = [
      freezeRow({ freeze_state: "restore_requested", stripe_account_id: ACCT, prior_schedule: { interval: "weekly", delay_days: 3, weekly_anchor: "friday" } }),
    ];

    const res = await call(`Bearer ${SERVICE}`, { helper_id: HELPR });

    expect((await bodyOf(res)).ok).toBe(true);
    expect(stripeMock.accounts.update.mock.calls[0][1]).toEqual({
      settings: { payouts: { schedule: { interval: "weekly", delay_days: 3, weekly_anchor: "friday" } } },
    });
    expect(scenario.writes.some((w) => w.table === "payout_schedule_freezes" && w.op === "delete")).toBe(true);
  });

  it("a non-admin is refused before anything is read or sent", async () => {
    scenario.authUser = { id: HELPR, email: "helpr@example.test" };
    scenario.rpc.has_role = false;

    const res = await call("Bearer user-jwt", { helper_id: HELPR });

    expect(res.status).toBe(403);
    expect(stripeMock.accounts.update).not.toHaveBeenCalled();
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("a FAILED pause pages critical and leaves ONE admin note from the admin who held", async () => {
    stripeMock.accounts.update.mockRejectedValue(new Error("Stripe is down"));

    const res = await call(`Bearer ${SERVICE}`, { helper_id: HELPR });
    const body = await bodyOf(res);

    expect(body.ok).toBe(false);
    expect(body.results[0]).toMatchObject({ kind: "failed", message: "Stripe is down", attempts: 1 });
    const page = alerts().find((a) => /NOT paused/.test(a.title));
    expect(page?.kind).toBe("money_at_risk");
    expect(page?.severity).toBe("critical");
    expect(notes()).toHaveLength(1);
    expect(notes()[0].payload).toMatchObject({ user_id: HELPR, admin_id: ADMIN.id, category: "billing" });
    expect(String((notes()[0].payload as { note: string }).note)).toMatch(/could NOT be paused/);
  });

  it("a retry that fails again pages but does not stack another note", async () => {
    scenario.reads.payout_schedule_freezes.selectOverrides = [{ includes: "freeze_error", result: { rows: [{ attempts: 1, freeze_error: "Stripe is down" }] } }];
    stripeMock.accounts.update.mockRejectedValue(new Error("Stripe is down"));

    await call(`Bearer ${SERVICE}`, { helper_id: HELPR });

    expect(alerts().some((a) => /NOT paused/.test(a.title))).toBe(true);
    expect(notes()).toHaveLength(0);
  });

  it("a FAILED restore pages that the Helpr is still on manual", async () => {
    scenario.reads.payout_schedule_freezes.rows = [
      freezeRow({ freeze_state: "restore_requested", stripe_account_id: ACCT, prior_schedule: { interval: "daily", delay_days: 2 } }),
    ];
    stripeMock.accounts.update.mockRejectedValue(new Error("rate limited"));

    const body = await bodyOf(await call(`Bearer ${SERVICE}`, { helper_id: HELPR }));

    expect(body.ok).toBe(false);
    expect(alerts().some((a) => /NOT restored/.test(a.title) && a.severity === "critical")).toBe(true);
    expect(scenario.writes.some((w) => w.table === "payout_schedule_freezes" && w.op === "delete")).toBe(false);
  });

  it("a service sweep with no helper_id settles every open request", async () => {
    scenario.reads.payout_schedule_freezes.selectOverrides = [
      { includes: "freeze_error", result: { rows: [{ attempts: 0, freeze_error: null }] } },
      { includes: "requested_at", result: { rows: [freezeRow({ prior_schedule: { interval: "daily", delay_days: 2 }, stripe_account_id: ACCT })] } },
      { includes: "helper_id", result: { rows: [{ helper_id: HELPR }] } },
    ];

    const res = await call(`Bearer ${SERVICE}`, null);

    expect(res.status).toBe(200);
    const listRead = scenario.readQueries.find((q) => q.table === "payout_schedule_freezes");
    expect(listRead?.filters).toContainEqual({ op: "in", column: "freeze_state", value: ["pause_requested", "restore_requested"] });
    expect(stripeMock.accounts.update).toHaveBeenCalledTimes(1);
  });

  it("a paused row whose Stripe schedule drifted back to daily is set to manual again and paged", async () => {
    scenario.reads.payout_schedule_freezes.rows = [
      freezeRow({ freeze_state: "paused", stripe_account_id: ACCT, prior_schedule: { interval: "daily", delay_days: 2 } }),
    ];

    const body = await bodyOf(await call(`Bearer ${SERVICE}`, { helper_id: HELPR }));

    expect(body.results[0]).toMatchObject({ kind: "paused", drifted: true });
    expect(stripeMock.accounts.update.mock.calls[0][1]).toEqual({ settings: { payouts: { schedule: { interval: "manual" } } } });
    expect(alerts().some((a) => a.kind === "money_at_risk" && /come back on while held/.test(a.title))).toBe(true);
  });

  it("re-review: a restore that landed at Stripe while a re-hold flipped the row to paused is re-verified at once (drift, not a stuck page)", async () => {
    scenario.reads.payout_schedule_freezes.rows = [
      freezeRow({ freeze_state: "restore_requested", stripe_account_id: ACCT, prior_schedule: { interval: "daily", delay_days: 2 } }),
    ];
    // Stripe takes the restore (daily) ...
    stripeMock.accounts.retrieve.mockResolvedValue({ id: ACCT, settings: { payouts: { schedule: { interval: "daily", delay_days: 2 } } } });
    // ... then the row delete fails, and meanwhile a re-hold made it 'paused'.
    scenario.writeOverrides = [{
      table: "payout_schedule_freezes",
      op: "delete",
      when: () => {
        const rows = scenario.reads.payout_schedule_freezes.rows ?? [];
        rows[0] = { ...rows[0], freeze_state: "paused" };
        return true;
      },
      error: { message: "connection reset", code: "08006" },
    }];

    const body = await bodyOf(await call(`Bearer ${SERVICE}`, { helper_id: HELPR }));

    expect(body.results[0]).toMatchObject({ kind: "paused", drifted: true });
    const schedules = stripeMock.accounts.update.mock.calls.map((c) => c[1].settings.payouts.schedule.interval);
    expect(schedules, "the Helpr was left on daily payouts while the row said paused").toEqual(["daily", "manual"]);
    expect(alerts().some((a) => /come back on while held/.test(a.title))).toBe(true);
  });

  it("the sweep also re-checks paused rows not verified for 6 hours", async () => {
    scenario.reads.payout_schedule_freezes.selectOverrides = [
      { includes: "freeze_error", result: { rows: [{ attempts: 0, freeze_error: null }] } },
      { includes: "requested_at", result: { rows: [freezeRow({ freeze_state: "paused", stripe_account_id: ACCT, prior_schedule: { interval: "daily", delay_days: 2 } })] } },
      { includes: "verified_at", result: { rows: [{ helper_id: HELPR, verified_at: null }] } },
      { includes: "helper_id", result: { rows: [] } },
    ];

    const body = await bodyOf(await call(`Bearer ${SERVICE}`, null));

    const pausedRead = scenario.readQueries.find((q) => q.table === "payout_schedule_freezes" && String(q.cols).includes("verified_at"));
    expect(pausedRead?.filters).toContainEqual({ op: "eq", column: "freeze_state", value: "paused" });
    expect(body.results.map((r: { helper_id: string }) => r.helper_id)).toEqual([HELPR]);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith(ACCT);
  });

  it("an admin must name the Helpr; a bad id is refused", async () => {
    scenario.authUser = ADMIN;
    scenario.rpc.has_role = true;
    expect((await call("Bearer admin-jwt", {})).status).toBe(400);
    expect((await call("Bearer admin-jwt", { helper_id: "not-a-uuid" })).status).toBe(400);
  });
});
