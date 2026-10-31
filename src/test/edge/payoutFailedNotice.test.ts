/**
 * Board 143a: a member's bank payout that FAILS is recorded and the member is
 * told, on the real stripe-webhook source. Record and notice only: no money
 * moves. One record and one notice per payout; a failed notice undoes the
 * record and answers 500 so Stripe redelivers (never a recorded failure nobody
 * was told about). payout.paid closes the account's open failures.
 *
 * @mutate supabase/functions/stripe-webhook/index.ts |   "payout.failed": handlePayoutFailed, |   "payout.failed_disabled": handlePayoutFailed,
 * @mutate supabase/functions/stripe-webhook/handlers/payoutFailed.ts |   if (!inserted \|\| inserted.length === 0) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/payoutFailed.ts |   if (!sent) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/payoutPaid.ts |     .is("resolved_at", null) |     .not("resolved_at", "is", "x")
 * @mutate supabase/functions/stripe-webhook/index.ts |     const connectRefused = verifiedByConnectSecret && !CONNECT_EVENT_TYPES.has(event.type); |     const connectRefused = false;
 * @mutate supabase/functions/stripe-webhook/index.ts |     for (const secret of connectWebhookSecrets) { |     for (const secret of [] as string[]) {
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}
const post = (fn: EdgeHarness) =>
  fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
function event(id: string, type: string, object: Record<string, unknown>, account: string | undefined = "acct_member") {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id, type, account, created: 1792550000, data: { object } });
}
const payout = (over: Record<string, unknown> = {}) => ({ id: "po_1", amount: 8480, currency: "usd", failure_code: "account_closed", ...over });
const writes = (table: string, op?: string) => scenario.writes.filter((w) => w.table === table && (!op || w.op === op));
const notices = () => writes("notifications", "insert").map((w) => w.payload as { user_id: string; title: string; message: string; link: string });

describe("payout.failed: recorded and the member is told (board 143a)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  // Jobs audit 54b: a bank-returned instant payout owes its fee back. Only a row
  // whose fee was earned moves (`kept`), and the money itself moves at the next
  // cash-out (instant-payout-one-fee.test.ts), never in this handler.
  // @mutate supabase/functions/stripe-webhook/handlers/payoutFailed.ts |     .eq("fee_state", "kept") |     .eq("fee_state", "none")
  it("a bank-returned instant payout marks its fee as owed back and pages", async () => {
    const fn = await load();
    event("evt_f9", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    scenario.writeSelectRows["instant_payouts"] = [{ id: "ip-1" }];
    expect((await post(fn)).status).toBe(200);
    const mark = writes("instant_payouts", "update")[0];
    expect(mark.payload).toMatchObject({ status: "failed", fee_state: "taken" });
    expect(mark.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "stripe_payout_id", value: "po_1" }),
      expect.objectContaining({ column: "fee_state", value: "kept" }),
    ]));
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
    expect((slackAlerts as Array<{ title: string }>).some((a) => a.title === "A bank returned an instant payout: its fee is owed back")).toBe(true);
  });

  // Review of 9c498193ff #3: the mark ran after the duplicate check, so a
  // redelivery of an event whose failure was already recorded returned early and
  // the fee stayed "kept" (a second fee could follow); and a failed mark only
  // logged. It now runs first and a failed mark answers 500 (Stripe redelivers).
  // @mutate supabase/functions/stripe-webhook/handlers/payoutFailed.ts |   if (instantErr) throw new Error(`payout.failed: could not mark instant payout ${payout.id}: ${instantErr.message}`); |   if (instantErr) console.error(instantErr.message);
  it("a redelivery whose failure is already recorded still marks the instant fee owed", async () => {
    const fn = await load();
    event("evt_f10", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    scenario.writeSelectRows["payout_failures:insert"] = [];
    scenario.writeSelectRows["instant_payouts"] = [{ id: "ip-1", helper_id: "member-1" }];
    expect((await post(fn)).status).toBe(200);
    expect(writes("instant_payouts", "update")[0]?.payload).toMatchObject({ fee_state: "taken" });
    expect(notices()).toHaveLength(0);
  });

  it("an instant row that cannot be marked answers 500 so Stripe redelivers", async () => {
    const fn = await load();
    event("evt_f11", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    scenario.writeErrors.instant_payouts = { message: "db down" };
    expect((await post(fn)).status).toBe(500);
  });

  // Review of 9c498193ff #4: a test account's returned payout goes to the digest, never the owner's phone.
  // @mutate supabase/functions/stripe-webhook/handlers/payoutFailed.ts |       seed: await isTestPayee(supabase, event, instantRow.helper_id), |       seed: false,
  it("a test account's bank-returned instant payout is a seed alert; a real member's pages", async () => {
    const fn = await load();
    event("evt_f12", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }, { user_id: "helper-test", is_seed: true }] };
    scenario.reads.test_accounts = { rows: [{ user_id: "helper-test" }] };
    scenario.writeSelectRows["instant_payouts"] = [{ id: "ip-1", helper_id: "helper-test" }];
    expect((await post(fn)).status).toBe(200);
    const page = (slackAlerts as Array<{ title: string; seed?: boolean }>).find((a) => a.title === "A bank returned an instant payout: its fee is owed back");
    expect(page?.seed).toBe(true);

    resetSharedMocks();
    scenario.writeSelectRows["instant_payouts"] = [{ id: "ip-2", helper_id: "member-1" }];
    scenario.reads.test_accounts = { rows: [] };
    event("evt_f13", "payout.failed", payout({ id: "po_9" }));
    expect((await post(fn)).status).toBe(200);
    const real = (slackAlerts as Array<{ title: string; seed?: boolean }>).find((a) => a.title === "A bank returned an instant payout: its fee is owed back");
    expect(real?.seed).toBe(false);
  });

  it("an ordinary payout that fails touches no instant row and pages nothing about a fee", async () => {
    const fn = await load();
    event("evt_f8", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    scenario.writeSelectRows["instant_payouts"] = [];
    expect((await post(fn)).status).toBe(200);
    expect((slackAlerts as Array<{ title: string }>).some((a) => a.title === "A bank returned an instant payout: its fee is owed back")).toBe(false);
  });

  it("records the failure and sends one notice with the real amount", async () => {
    const fn = await load();
    event("evt_f1", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    expect((await post(fn)).status).toBe(200);
    const rec = writes("payout_failures", "insert").map((w) => w.payload as Record<string, unknown>);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ user_id: "member-1", stripe_payout_id: "po_1", stripe_event_id: "evt_f1", amount_cents: 8480, failure_code: "account_closed" });
    const told = notices();
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ user_id: "member-1", title: "Your payout didn't go through", link: "/profile?tab=earnings" });
    expect(told[0].message).toBe("Your payout of $84.80 didn't go through. Update your bank or card in You → Money.");
  });

  it("a payout already recorded sends no second notice", async () => {
    const fn = await load();
    event("evt_f2", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    scenario.writeSelectRows["payout_failures:insert"] = [];
    expect((await post(fn)).status).toBe(200);
    expect(notices()).toHaveLength(0);
  });

  it("a notice that fails undoes the record and answers 500 so Stripe redelivers", async () => {
    const fn = await load();
    event("evt_f3", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    scenario.writeErrors.notifications = { message: "boom" };
    expect((await post(fn)).status).toBe(500);
    expect(writes("payout_failures", "delete")).toHaveLength(1);
  });

  it("a member lookup error answers 500 (never a silent skip)", async () => {
    const fn = await load();
    event("evt_f4", "payout.failed", payout());
    scenario.reads.profiles = { error: { message: "db down" } } as never;
    expect((await post(fn)).status).toBe(500);
    expect(writes("payout_failures")).toHaveLength(0);
  });

  it("the platform's own payout (no account) records nothing for a member", async () => {
    const fn = await load();
    event("evt_f5", "payout.failed", payout(), undefined);
    expect((await post(fn)).status).toBe(200);
    expect(writes("payout_failures")).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("payout.paid closes that account's open failures, and writes nothing else", async () => {
    const fn = await load();
    event("evt_p1", "payout.paid", payout({ id: "po_2", failure_code: null }));
    expect((await post(fn)).status).toBe(200);
    const upd = writes("payout_failures", "update");
    expect(upd).toHaveLength(1);
    expect(upd[0].payload).toEqual({ resolved_at: new Date(1792550000 * 1000).toISOString() });
    expect(notices()).toHaveLength(0);
  });
});

describe("the Connect endpoint's own signing secret (lead 10-21)", () => {
  const LIVE = "whsec_live", CONNECT = "whsec_connect";
  async function loadBoth(): Promise<EdgeHarness> {
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      STRIPE_WEBHOOK_SECRET: LIVE,
      STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT,
    });
    return loadEdgeFunction("stripe-webhook");
  }
  /** Only the CONNECT secret verifies this delivery, as Stripe signs per endpoint. */
  function connectSigned(id: string, type: string, object: Record<string, unknown>, account = "acct_member") {
    stripeMock.webhooks.constructEventAsync.mockImplementation(async (_b: unknown, _s: unknown, secret: string) => {
      if (secret !== CONNECT) throw new Error("No signatures found matching the expected signature for payload");
      return { id, type, account, created: 1792550000, data: { object } };
    });
  }

  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("a Connect-signed payout.failed for a known account inserts exactly one row", async () => {
    const fn = await loadBoth();
    connectSigned("evt_c1", "payout.failed", payout());
    scenario.reads.profiles = { rows: [{ user_id: "member-1" }] };
    expect((await post(fn)).status).toBe(200);
    const rec = writes("payout_failures", "insert").map((w) => w.payload as Record<string, unknown>);
    expect(rec).toHaveLength(1);
    expect(rec[0]).toMatchObject({ stripe_event_id: "evt_c1", stripe_account_id: "acct_member", user_id: "member-1" });
    expect(notices()).toHaveLength(1);
  });

  it("a Connect-signed payout.failed for an unknown account is a logged no-op", async () => {
    const fn = await loadBoth();
    connectSigned("evt_c2", "payout.failed", payout(), "acct_nobody");
    scenario.reads.profiles = { rows: [] };
    expect((await post(fn)).status).toBe(200);
    expect(writes("payout_failures")).toHaveLength(0);
    expect(notices()).toHaveLength(0);
  });

  it("a Connect-signed event of any other type reaches no handler", async () => {
    const fn = await loadBoth();
    connectSigned("evt_c3", "charge.refunded", { id: "ch_x", payment_intent: "pi_x", amount_refunded: 100 });
    const logs = vi.spyOn(console, "log");
    expect((await post(fn)).status).toBe(200);
    const lines = logs.mock.calls.map((c) => String(c[0]));
    logs.mockRestore();
    expect(lines.some((l) => l.includes("Connect endpoint event not routed"))).toBe(true);
    const sideEffects = scenario.writes.filter((w) => w.table !== "stripe_webhook_events");
    expect(sideEffects).toEqual([]);
  });

  it("a delivery no secret verifies is refused (400), fail closed", async () => {
    const fn = await loadBoth();
    stripeMock.webhooks.constructEventAsync.mockRejectedValue(new Error("No signatures found"));
    expect((await post(fn)).status).toBe(400);
    expect(writes("payout_failures")).toHaveLength(0);
  });
});

