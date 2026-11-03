/**
 * Q2368 (lead 11-03): a stripe-connect `reset` and stripe-webhook accountUpdated's dead-account gate close each leave
 * one durable, record-only error_logs row (severity info, tags.source 'stripe-connect', tags.kind 'connect-reset' /
 * 'connect-dead-account-close', the user and the old and new account ids). Before, the first was a console line and
 * the second a function log, so on 2026-10-23 a lost account and three closed gates could not be traced.
 *
 * The rows never page or open a ledger item: the database half (error_log_is_record_only in both error_logs
 * triggers) is src/test/connectRecordOnlyRowsNeverPage.test.ts and its PGlite proof.
 *
 * Runs the REAL stripe-connect and stripe-webhook sources through the edge harness.
 *
 * @mutate supabase/functions/stripe-connect/index.ts |       await recordConnectChange(supabaseAdmin, { kind: "connect-reset", userId: user.id, oldAccountId, newAccountId: accountId }); |
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts |         await recordConnectChange(supabase, { kind: "connect-dead-account-close", userId: helperProfile.user_id, oldAccountId: accountId, newAccountId: null }); |
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts |       if ((closedRows?.length ?? 0) > 0) { |       if (true) {
 * @mutate supabase/functions/_shared/connectRecord.ts |     severity: "info", |     severity: "error",
 * @mutate supabase/functions/_shared/connectRecord.ts |   if (error) console.error(`[connect-record] could not record ${r.kind} for ${r.userId}: ${error.message}`); |   if (error) throw new Error(error.message);
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER = { id: "user-q2368", email: "q2368@example.test" };
const ACCT = "acct_q2368_old";

const records = () =>
  scenario.writes
    .filter((w) => w.table === "error_logs" && w.op === "insert")
    .map((w) => w.payload as { severity: string; user_id: string; tags: Record<string, unknown>; context: Record<string, unknown> })
    .filter((p) => p.tags?.source === "stripe-connect" && String(p.tags?.kind ?? "").startsWith("connect-"));

describe("stripe-connect reset leaves a record (Q2368)", () => {
  beforeEach(() => {
    resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_live_x" });
    scenario.authUser = USER;
    scenario.reads.profiles = { rows: [{ stripe_account_id: ACCT }] };
    scenario.reads.error_logs = { rows: [], count: 0 };
    stripeMock.accounts.del.mockResolvedValue({ id: ACCT, deleted: true });
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
  });
  afterEach(() => resetEnv());

  const reset = async () => {
    const fn = await loadEdgeFunction("stripe-connect");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body: { action: "reset", return_url: "https://louisianahelpr.com/profile" } }));
  };

  it("one info row naming the user and the old account", async () => {
    const res = await reset();
    expect(res.status).toBe(200);
    const r = records();
    expect(r.length, "inventory floor: the reset was recorded").toBeGreaterThan(0);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ severity: "info", user_id: USER.id, tags: { source: "stripe-connect", kind: "connect-reset" } });
    expect(r[0].context.old_account_id).toBe(ACCT);
    expect("new_account_id" in r[0].context).toBe(true);
  });

  it("a reset that stops before relinking records nothing", async () => {
    scenario.writeSelectRows.profiles = [];
    const res = await reset();
    expect(res.status).toBe(500);
    expect(records()).toEqual([]);
  });

  it("a failed record never fails the reset (it already happened)", async () => {
    scenario.writeErrors.error_logs = { message: "insert failed", code: "XX000" };
    const res = await reset();
    expect(res.status).toBe(200);
  });
});

describe("accountUpdated's dead-account gate close leaves a record (Q2368)", () => {
  beforeEach(() => {
    resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", STRIPE_WEBHOOK_SECRET: "whsec_test_secret" });
    scenario.reads.profiles = { rows: [{ user_id: USER.id, full_name: "Q2368 Helpr", email_verified: true, stripe_identity_verified: true, stripe_charges_enabled: true, stripe_payouts_enabled: true }] };
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error(`No such account: '${ACCT}'`), { statusCode: 404, code: "account_invalid" }));
  });
  afterEach(() => resetEnv());

  const deliver = async () => {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_q2368", type: "account.updated", account: ACCT, data: { object: { id: ACCT } } });
    const fn = await loadEdgeFunction("stripe-webhook");
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
  };

  it("a gate this delivery closed: one info row naming the user and the dead account", async () => {
    const res = await deliver();
    expect(res.status).toBe(200);
    const r = records();
    expect(r.length, "inventory floor: the close was recorded").toBeGreaterThan(0);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ severity: "info", user_id: USER.id, tags: { source: "stripe-connect", kind: "connect-dead-account-close" } });
    expect(r[0].context).toEqual({ old_account_id: ACCT, new_account_id: null });
  });

  it("nothing closed (the link already moved on): no record", async () => {
    scenario.writeSelectRows.profiles = [];
    const res = await deliver();
    expect(res.status).toBe(200);
    expect(records()).toEqual([]);
  });

  it("a failed record never fails the delivery", async () => {
    scenario.writeErrors.error_logs = { message: "insert failed", code: "XX000" };
    const res = await deliver();
    expect(res.status).toBe(200);
  });
});
