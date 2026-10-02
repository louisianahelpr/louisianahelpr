/**
 * Q872 / Q874 / Q875 — stripe-webhook `account.updated` (handlers/accountUpdated.ts).
 *
 * Q872 the residual same-snapshot race: a delivery holding an OLDER enabled
 *   retrieve can win its CAS after a newer restricted delivery skipped. A
 *   write that moves the cache INTO enabled now re-asks Stripe; if Stripe
 *   disagrees, the cache is reverted by a CAS on the values just written and
 *   no "verified" notice goes out.
 * Q874 "Payout account needs attention" went out once per account.updated in
 *   a restricted burst. Now only when the helper has no UNREAD copy; a failed
 *   check throws so Stripe redelivers.
 * Q875 a dead (unretrievable) account closes the cached gate, scoped to this
 *   user and this account id.
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if (recheck && !(recheck.charges && recheck.payouts)) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("stripe_charges_enabled", chargesEnabled)\n | \n
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | throw new Error(`Could not revert a stale enabled cache | return; throw new Error(`Could not revert a stale enabled cache
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | recheck = { identity: false, charges: false, payouts: false }; |
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if ((unread?.length ?? 0) > 0) { | if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("read", false)\n | \n
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | throw new Error(`Could not check for an unread payout notice | return; throw new Error(`Could not check for an unread payout notice
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | throw new Error(`Could not close the cached payout gate | return; throw new Error(`Could not close the cached payout gate
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("user_id", helperProfile.user_id)\n        .eq("stripe_account_id", accountId)\n        .select("id"); | .eq("user_id", helperProfile.user_id)\n        .select("id");
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER_ID = "user-q872";
const ACCT = "acct_q872_event";
const NO_REQS = { currently_due: [], eventually_due: [], past_due: [], errors: [] };
const ENABLED = {
  id: ACCT,
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { transfers: "active" },
  requirements: NO_REQS,
};
const RESTRICTED = {
  ...ENABLED,
  charges_enabled: false,
  payouts_enabled: false,
  capabilities: { transfers: "inactive" },
  requirements: { ...NO_REQS, currently_due: ["individual.verification.document"] },
};
const NEEDS_ATTENTION = "Payout account needs attention";

const cacheWrites = () =>
  scenario.writes.filter(
    (w) =>
      w.table === "profiles" &&
      w.op === "update" &&
      "stripe_payouts_enabled" in ((w.payload as Record<string, unknown>) ?? {}),
  );
const noticeTitles = () =>
  scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]))
    .map((p) => (p as { title?: string }).title);

function onFile(flags: { identity: boolean; charges: boolean; payouts: boolean }) {
  scenario.reads.profiles = {
    rows: [{
      user_id: USER_ID,
      full_name: "Q872 Helpr",
      email_verified: true,
      stripe_identity_verified: flags.identity,
      stripe_charges_enabled: flags.charges,
      stripe_payouts_enabled: flags.payouts,
    }],
  };
}

async function deliver(payload: Record<string, unknown>) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_q872",
    type: "account.updated",
    data: { object: payload },
  });
  const fn = await loadEdgeFunction("stripe-webhook");
  return fn.fetch(fn.request({
    rawBody: "{}",
    headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" },
  }));
}

describe("Q872/Q874/Q875 — account.updated re-confirms enabled, de-dupes needs-attention, closes a dead gate", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_test_abc",
      STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
    });
    onFile({ identity: false, charges: false, payouts: false });
    scenario.reads.notifications = { rows: [] };
  });
  afterEach(() => resetEnv());

  // ─── Q872 ───
  it("Q872: an enabled write Stripe no longer agrees with is reverted by CAS, and no verified notice goes out", async () => {
    stripeMock.accounts.retrieve.mockResolvedValueOnce(ENABLED).mockResolvedValueOnce(RESTRICTED);

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(2);
    const writes = cacheWrites();
    expect(writes.length, "inventory floor: the cache writes ran").toBeGreaterThan(0);
    expect(writes).toHaveLength(2);
    expect(writes[1].payload).toEqual({
      stripe_identity_verified: false,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });
    expect(writes[1].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER_ID },
        { op: "eq", column: "stripe_account_id", value: ACCT },
        { op: "eq", column: "stripe_charges_enabled", value: true },
        { op: "eq", column: "stripe_payouts_enabled", value: true },
      ]),
    );
    expect(writes[1].selectCols).toBe("id");
    expect(noticeTitles()).not.toContain("Payout account verified");
  });

  it("Q872: a re-check that finds the account gone also reverts", async () => {
    stripeMock.accounts.retrieve
      .mockResolvedValueOnce(ENABLED)
      .mockRejectedValueOnce(Object.assign(new Error(`No such account: '${ACCT}'`), {
        statusCode: 404, code: "resource_missing", type: "StripeInvalidRequestError",
      }));

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(cacheWrites()).toHaveLength(2);
    expect(noticeTitles()).not.toContain("Payout account verified");
  });

  it("Q872: a re-check that agrees keeps the write and sends one verified notice", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(cacheWrites()).toHaveLength(1);
    expect(noticeTitles()).toEqual(["Payout account verified"]);
  });

  it("Q872: a revert that errors answers 500 so Stripe redelivers", async () => {
    stripeMock.accounts.retrieve.mockResolvedValueOnce(ENABLED).mockResolvedValueOnce(RESTRICTED);
    // The mock records a write before it looks up its error, so this getter
    // lets the first profiles update succeed and fails the second (the revert).
    Object.defineProperty(scenario.writeErrors, "profiles", {
      configurable: true,
      enumerable: true,
      get: () => (cacheWrites().length >= 2 ? { message: "boom" } : undefined),
    });

    const res = await deliver(ENABLED);

    expect(res.status).toBe(500);
    expect(noticeTitles()).toEqual([]);
  });

  // ─── Q874 ───
  it("Q874: an unread needs-attention notice already showing suppresses another", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(RESTRICTED);
    scenario.reads.notifications = { rows: [{ id: "n-unread" }] };

    const res = await deliver(RESTRICTED);

    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual([]);
    const check = scenario.readQueries.find((q) => q.table === "notifications");
    expect(check, "inventory floor: the unread check ran").toBeTruthy();
    expect(check?.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER_ID },
        { op: "eq", column: "title", value: NEEDS_ATTENTION },
        { op: "eq", column: "read", value: false },
      ]),
    );
  });

  it("Q874: with none unread, exactly one needs-attention notice goes out", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(RESTRICTED);

    const res = await deliver(RESTRICTED);

    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual([NEEDS_ATTENTION]);
  });

  it("Q874: a failed unread check answers 500 and sends nothing", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(RESTRICTED);
    scenario.reads.notifications = { rows: [], error: { message: "permission denied for table notifications" } };

    const res = await deliver(RESTRICTED);

    expect(res.status).toBe(500);
    expect(noticeTitles()).toEqual([]);
  });

  // ─── Q875 ───
  it("Q875: a dead account closes the cached gate for this user and this account only", async () => {
    onFile({ identity: true, charges: true, payouts: true });
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error(`No such account: '${ACCT}'`), {
      statusCode: 404, code: "resource_missing", type: "StripeInvalidRequestError",
    }));

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    const writes = cacheWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({
      stripe_identity_verified: false,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER_ID },
        { op: "eq", column: "stripe_account_id", value: ACCT },
      ]),
    );
    expect(noticeTitles()).toEqual([]);
  });

  it("Q875: a gate close that errors answers 500 so Stripe redelivers", async () => {
    onFile({ identity: true, charges: true, payouts: true });
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error(`No such account: '${ACCT}'`), {
      statusCode: 404, code: "resource_missing", type: "StripeInvalidRequestError",
    }));
    scenario.writeErrors.profiles = { message: "permission denied for table profiles", code: "42501" };

    const res = await deliver(ENABLED);

    expect(res.status).toBe(500);
  });
});
