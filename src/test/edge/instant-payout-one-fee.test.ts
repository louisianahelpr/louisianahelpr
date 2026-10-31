/**
 * Jobs audit 54a: the instant-payout fee leaves the Helpr's balance BEFORE the
 * payout, so a failed payout followed by another press took a second fee. A
 * retry may never charge a second fee: the first one goes back (the rule the
 * function's own alert and row note always stated: "reverse the transfer"), and
 * while it has not gone back, no new attempt starts.
 *
 * The Stripe double keeps a real balance, so "one fee" is measured as money
 * (fees taken minus fees returned), not as a call count.
 */
// @mutate supabase/functions/instant-payout/index.ts | const unsettled = await settleUnreturnedInstantFees(stripeFor, supabaseAdmin, user.id, profile.stripe_account_id); | const unsettled = { kind: "clear" as const };
// @mutate supabase/functions/instant-payout/index.ts | if (recheckedCents !== availableCents) { | if (false) {
// @mutate supabase/functions/instant-payout/index.ts | if (recordErr && (recordErr as { code?: string }).code === "IP001") { | if (false) {
// @mutate supabase/functions/_shared/instantPayoutFeeReturn.ts | if (sent && sent.status !== "failed" && sent.status !== "canceled") { | if (false) {
// @mutate supabase/functions/_shared/instantPayoutFeeReturn.ts | const prior = (reversals?.data ?? []).find((r) => r.metadata?.instant_payout_id === row.id); | const prior = undefined as { id: string } \| undefined;
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

let fn: EdgeHarness;
let balance = 0;
let feesTaken = 0;
let feesReturned = 0;
let paidOut = 0;

const call = (action: string) =>
  fn.fetch(fn.request({
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer caller.jwt.sig" },
    body: { action },
  }));

/** The row as the database would hold it after the writes the function made. */
function persistedRow(): Record<string, unknown> {
  const row: Record<string, unknown> = { id: "ip-1", created_at: "2026-10-31T00:00:00Z", fee_amount: 3 };
  for (const w of scenario.writes) {
    if (w.table === "instant_payouts" && w.payload) Object.assign(row, w.payload);
  }
  return row;
}

/** What the function's own "still owed" read would match. */
function letTheDatabaseAnswer() {
  const row = persistedRow();
  scenario.reads.instant_payouts = {
    rows: row.status !== "pending" && ["attempting", "taken"].includes(String(row.fee_state)) ? [row] : [],
  };
}

const firstPayoutFails = () => {
  stripeMock.payouts.create.mockImplementationOnce(async () => {
    throw new Error("card declined the instant payout");
  });
};

const owedRow = (over: Record<string, unknown> = {}) => ({
  id: "ip-0", created_at: "2026-10-31T00:00:00Z", fee_amount: 3, fee_state: "taken", fee_transfer_id: "tr_old",
  status: "failed", error_message: null, ...over,
});
const firstInstantWrite = () =>
  scenario.writes.find((w) => w.table === "instant_payouts")?.payload as Record<string, unknown> | undefined;

beforeEach(async () => {
  resetEnv(); resetSupabaseMock(); resetSharedMocks(); resetStripeMock();
  setEnv({
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    SECRET_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_instant",
  });
  balance = 10_000; feesTaken = 0; feesReturned = 0; paidOut = 0;
  scenario.authUser = { id: "helper-1", email: "h@example.com" };
  scenario.reads.profiles = {
    rows: [{ stripe_account_id: "acct_helper", full_name: "H", subscription_tier: "basic", subscription_expires_at: null }],
  };
  scenario.writeSelectRows["instant_payouts:insert"] = [{ id: "ip-1" }];
  scenario.rpc.feature_enabled_for_user = true;
  stripeMock.balance.retrieve.mockImplementation(async () => ({ instant_available: [{ currency: "usd", amount: balance }] }));
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_platform" });
  stripeMock.transfers.create.mockImplementation(async (p: { amount: number }) => {
    balance -= p.amount; feesTaken += p.amount;
    return { id: `tr_fee_${feesTaken}` };
  });
  stripeMock.transfers.createReversal.mockImplementation(async () => {
    balance += 300; feesReturned += 300;
    return { id: "trr_1" };
  });
  stripeMock.payouts.create.mockImplementation(async (p: { amount: number }) => {
    balance -= p.amount; paidOut += p.amount;
    return { id: "po_1", arrival_date: 1 };
  });
  fn = await loadEdgeFunction("instant-payout");
});

describe("a failed instant cash-out never costs a second fee", () => {
  it("fail then retry: the first fee went back, so the Helpr pays one fee and gets the rest", async () => {
    firstPayoutFails();
    const failed = await call("execute");
    const failedBody = JSON.parse(await failed.text());
    expect(feesTaken).toBe(300);
    // Back at once, on the Helpr's own account, under a key fixed to this attempt.
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1);
    const [tid, , opts] = stripeMock.transfers.createReversal.mock.calls[0];
    expect(tid).toBe("tr_fee_300");
    expect(opts).toEqual({ stripeAccount: "acct_helper", idempotencyKey: "instant-payout-fee-return-ip-1" });
    // The reply tells the screen what is true.
    expect(failedBody.code).toBe("instant_payout_failed");
    expect(failedBody.fee).toBe("returned");
    expect(failedBody.can_retry).toBe(true);
    expect(failedBody.error).toMatch(/\$3\.00 fee went back/);
    expect(persistedRow().fee_state).toBe("returned");
    expect(persistedRow().status).toBe("failed");
    // No page asking a person to do what was just done.
    expect((slackAlerts as Array<{ title: string }>).some((a) => a.title === "Instant-payout fee taken but the payout failed")).toBe(false);

    letTheDatabaseAnswer();
    const retried = await call("execute");
    expect(retried.status).toBe(200);
    expect(feesTaken - feesReturned).toBe(300);
    expect(paidOut).toBe(9_700);
    expect(balance).toBe(0);
  });

  it("the fee could not go back: the retry is refused and takes no second fee", async () => {
    firstPayoutFails();
    stripeMock.transfers.createReversal.mockRejectedValue(new Error("stripe is down"));
    const failed = await call("execute");
    const body = JSON.parse(await failed.text());
    expect(body.fee).toBe("pending");
    expect(body.can_retry).toBe(false);
    expect(body.error).toMatch(/won't be charged a second fee/);
    // A person is told: this is the one branch still owed by hand.
    const page = (slackAlerts as Array<{ title: string; severity: string }>).find((a) => a.title === "Instant-payout fee taken but the payout failed");
    expect(page?.severity).toBe("critical");

    letTheDatabaseAnswer();
    const quote = await call("quote");
    expect(quote.status).toBe(409);
    expect(JSON.parse(await quote.text()).code).toBe("instant_fee_return_pending");
    const retry = await call("execute");
    expect(retry.status).toBe(409);
    expect(JSON.parse(await retry.text()).code).toBe("instant_fee_return_pending");
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.payouts.create).toHaveBeenCalledTimes(1);
    expect(feesTaken).toBe(300);
  });

  it("the return works on the next try: the fee comes back first, then one fee on the full balance", async () => {
    firstPayoutFails();
    stripeMock.transfers.createReversal.mockRejectedValueOnce(new Error("stripe is down"));
    await call("execute");
    letTheDatabaseAnswer();
    const retry = await call("execute");
    expect(retry.status).toBe(200);
    expect(feesTaken - feesReturned).toBe(300);
    expect(paidOut).toBe(9_700);
  });

  it("the payout went out after all (a stranded row): the fee was earned, nothing goes back", async () => {
    scenario.reads.instant_payouts = { rows: [owedRow()] };
    stripeMock.payouts.list.mockResolvedValue({ data: [{ id: "po_old", status: "paid", metadata: { instant_payout_id: "ip-0" } }] });
    const res = await call("quote");
    expect(res.status).toBe(200);
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
    expect(firstInstantWrite()?.fee_state).toBe("kept");
    // Review of 9c498193ff #5: the row says the payout went, and which one.
    expect(firstInstantWrite()).toMatchObject({ status: "completed", stripe_payout_id: "po_old" });
  });

  // Review of 9c498193ff #2: a reversal made by hand in the dashboard carries no
  // metadata; Stripe refuses a second reversal of a fully reversed transfer, so
  // the row stayed owed and cash-out was refused for good.
  // @mutate supabase/functions/_shared/instantPayoutFeeReturn.ts |     if (amount > 0 && (transfer?.amount_reversed ?? 0) >= amount) { |     if (false) {
  it("a reversal made by hand is adopted from Stripe's amount_reversed, never made again", async () => {
    scenario.reads.instant_payouts = { rows: [owedRow()] };
    stripeMock.transfers.listReversals.mockResolvedValue({ data: [{ id: "trr_hand", metadata: {} }] });
    stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_old", amount: 300, amount_reversed: 300 });
    const res = await call("quote");
    expect(res.status).toBe(200);
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
    expect(firstInstantWrite()).toMatchObject({ fee_state: "returned", fee_reversal_id: "trr_hand" });
  });

  it("a part reversal by hand is not the whole fee: the rest goes back", async () => {
    scenario.reads.instant_payouts = { rows: [owedRow()] };
    stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_old", amount: 300, amount_reversed: 100 });
    expect((await call("quote")).status).toBe(200);
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1);
  });

  // Review of 9c498193ff #1: the return ran after the hold and membership gates,
  // so while instant cash-out is off for everyone (memberships off) an owed fee
  // never went back. The money is the Helpr's own; it goes back whatever the gate.
  it("cash-out switched off: the owed fee still goes back, and the answer is still 'off'", async () => {
    scenario.rpc.feature_enabled_for_user = false;
    scenario.reads.instant_payouts = { rows: [owedRow()] };
    const res = await call("quote");
    expect(res.status).toBe(403);
    expect(JSON.parse(await res.text()).code).toBe("instant_payout_off");
    expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1);
    expect(firstInstantWrite()).toMatchObject({ fee_state: "returned" });
  });

  // Review of 9c498193ff #4: a test account's money alerts are seed alerts (the digest), never a page.
  // @mutate supabase/functions/instant-payout/index.ts |         client = { stripe: new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" }), seed: mode === "test" }; |         client = { stripe: new Stripe(stripeSecretKeyFor(mode), { apiVersion: "2025-08-27.basil" }), seed: false };
  it("a test account's stuck fee is a seed alert; a real Helpr's pages", async () => {
    setEnv({ STRIPE_TEST_SECRET_KEY: "sk_test_tst" });
    scenario.reads.profiles = {
      rows: [{ user_id: "helper-1", is_seed: true, stripe_account_id: "acct_helper", full_name: "H", subscription_tier: "basic", subscription_expires_at: null }],
    };
    scenario.reads.test_accounts = { rows: [{ user_id: "helper-1" }] };
    firstPayoutFails();
    stripeMock.transfers.createReversal.mockRejectedValue(new Error("stripe is down"));
    await call("execute");
    const pages = (slackAlerts as Array<{ title: string; seed?: boolean }>).filter((a) => a.title === "Instant-payout fee taken but the payout failed");
    expect(pages).toHaveLength(1);
    expect(pages[0].seed).toBe(true);
  });

  it("a real Helpr's stuck fee pages (seed false)", async () => {
    firstPayoutFails();
    stripeMock.transfers.createReversal.mockRejectedValue(new Error("stripe is down"));
    await call("execute");
    const page = (slackAlerts as Array<{ title: string; seed?: boolean }>).find((a) => a.title === "Instant-payout fee taken but the payout failed");
    expect(page?.seed).toBe(false);
  });

  it("a reversal Stripe already holds is adopted, never made twice", async () => {
    scenario.reads.instant_payouts = { rows: [owedRow()] };
    stripeMock.transfers.listReversals.mockResolvedValue({ data: [{ id: "trr_old", metadata: { instant_payout_id: "ip-0" } }] });
    const res = await call("quote");
    expect(res.status).toBe(200);
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
    expect(firstInstantWrite()).toMatchObject({ fee_state: "returned", fee_reversal_id: "trr_old" });
  });

  it("the row was stranded before the fee id was saved: the transfer is found by its attempt id", async () => {
    scenario.reads.instant_payouts = { rows: [owedRow({ fee_state: "attempting", fee_transfer_id: null })] };
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: "tr_found", metadata: { instant_payout_id: "ip-0" } }] });
    const res = await call("quote");
    expect(res.status).toBe(200);
    expect(stripeMock.transfers.createReversal.mock.calls[0][0]).toBe("tr_found");
  });

  it("no fee was taken: a failed payout says nothing was charged, and a retry is open", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(new Error("platform lookup timed out"));
    firstPayoutFails();
    const body = JSON.parse(await (await call("execute")).text());
    expect(body.fee).toBe("none");
    expect(body.can_retry).toBe(true);
    expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
  });
});

describe("two presses", () => {
  it("at the same moment: one attempt, one fee", async () => {
    let open = false;
    scenario.writeOverrides = [{
      table: "instant_payouts", op: "insert",
      when: () => { if (open) return true; open = true; return false; },
      error: { message: "duplicate key", code: "23505" },
    }];
    const [a, b] = await Promise.all([call("execute"), call("execute")]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.payouts.create).toHaveBeenCalledTimes(1);
  });

  it("the second reached the database after the first failed: the database refuses it, no fee", async () => {
    scenario.writeOverrides = [{
      table: "instant_payouts", op: "insert", when: () => true,
      error: { message: "instant_payout_fee_unresolved", code: "IP001" },
    }];
    const res = await call("execute");
    expect(res.status).toBe(409);
    expect(JSON.parse(await res.text()).code).toBe("instant_fee_return_pending");
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });

  it("the balance moved while the second waited: its stale fee is never taken", async () => {
    stripeMock.balance.retrieve
      .mockImplementationOnce(async () => ({ instant_available: [{ currency: "usd", amount: 10_000 }] }))
      .mockImplementationOnce(async () => ({ instant_available: [{ currency: "usd", amount: 0 }] }));
    const res = await call("execute");
    expect(res.status).toBe(409);
    expect(JSON.parse(await res.text()).code).toBe("instant_balance_changed");
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(stripeMock.payouts.create).not.toHaveBeenCalled();
    // The attempt lets go, so the next press is not locked out.
    const release = scenario.writes.find((w) => w.table === "instant_payouts" && (w.payload as { status?: string })?.status === "failed");
    expect(release?.payload).toMatchObject({ fee_state: "none" });
  });
});
