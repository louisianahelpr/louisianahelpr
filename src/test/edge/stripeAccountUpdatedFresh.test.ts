/**
 * Q869 / Q870 — the lh-money-escrow notes on 3e95ae39c, both in
 * stripe-webhook `account.updated` (handlers/accountUpdated.ts).
 *
 * Q869: the handler cached the EVENT PAYLOAD's charges/payouts flags. Stripe
 *   delivers late and out of order, so an older `payouts_enabled=true` event
 *   arriving after a newer restricted one re-opened the payout/hiring gate.
 *   Now the flags come from a fresh `stripe.accounts.retrieve(<event account>)`
 *   and the cache write is a compare-and-set on a profile snapshot read BEFORE
 *   that retrieve, so an older delivery cannot overwrite a newer write. A lost
 *   CAS whose winner cached the same flags is a quiet 200; one whose winner
 *   cached different flags answers 500 and Stripe redelivers.
 * Q870: "Payout account verified" went out on EVERY account.updated for an
 *   enabled helper. Now only the write that moves the cache into enabled
 *   sends it.
 *
 * Runs the REAL function source through the edge harness.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | account = await stripe.accounts.retrieve(accountId); | account = event.data.object as Stripe.Account;
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("stripe_identity_verified", helperProfile.stripe_identity_verified)\n | \n
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("stripe_charges_enabled", helperProfile.stripe_charges_enabled)\n | \n
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | .eq("stripe_payouts_enabled", helperProfile.stripe_payouts_enabled)\n | \n
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | becameEnabled = nowEnabled && !wasEnabled; | becameEnabled = nowEnabled;
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if (becameEnabled) { | if (nowEnabled) {
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | let becameEnabled = false; | let becameEnabled = nowEnabled && !wasEnabled;
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | } else if (!nowEnabled && account.requirements | } else if (account.requirements
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if (current?.stripe_account_id !== account.id) { | if (true) {
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | throw new Error(`Cached payout flags for | return; throw new Error(`Cached payout flags for
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if (isUnusableConnectAccountError(err)) {\n      // The account is gone | if (true) {\n      // The account is gone
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if (isUnusableConnectAccountError(err)) {\n      // The account is gone | if (false) {\n      // The account is gone
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | const { data: helperProfile, error: helperProfileError } = await supabase | await stripe.accounts.retrieve(accountId); const { data: helperProfile, error: helperProfileError } = await supabase
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | logStep("Skipped account.updated: no profile links this account", { accountId });\n    return; | logStep("Skipped account.updated: no profile links this account", { accountId });
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | current.stripe_identity_verified === identityVerified && | false &&
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | current.stripe_payouts_enabled === payoutsEnabled\n | true\n
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const USER_ID = "user-q869";
const ACCT = "acct_q869_event";
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
  id: ACCT,
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: true,
  capabilities: { transfers: "inactive" },
  requirements: { ...NO_REQS, currently_due: ["individual.verification.document"] },
};

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
      full_name: "Q869 Helpr",
      email_verified: true,
      stripe_identity_verified: flags.identity,
      stripe_charges_enabled: flags.charges,
      stripe_payouts_enabled: flags.payouts,
    }],
  };
}

describe("Q869/Q870 — account.updated caches Stripe's CURRENT account, notices only on the transition", () => {
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
  });
  afterEach(() => resetEnv());

  async function deliver(payload: Record<string, unknown>) {
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_q869",
      type: "account.updated",
      data: { object: payload },
    });
    const fn = await loadEdgeFunction("stripe-webhook");
    return fn.fetch(fn.request({
      rawBody: "{}",
      headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" },
    }));
  }

  it("Q869: an out-of-order ENABLED payload does not re-open the gate when Stripe now says restricted", async () => {
    onFile({ identity: true, charges: true, payouts: true });
    stripeMock.accounts.retrieve.mockResolvedValue(RESTRICTED);

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledWith(ACCT);
    const writes = cacheWrites();
    expect(writes.length, "inventory floor: the cache write ran").toBeGreaterThan(0);
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({
      stripe_identity_verified: false,
      stripe_charges_enabled: false,
      stripe_payouts_enabled: false,
    });
    expect(noticeTitles()).not.toContain("Payout account verified");
  });

  it("Q869: the cache write compares-and-sets on the values it read, and reads back", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await deliver(RESTRICTED);

    expect(res.status).toBe(200);
    const writes = cacheWrites();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ stripe_charges_enabled: true, stripe_payouts_enabled: true });
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER_ID },
        { op: "eq", column: "stripe_account_id", value: ACCT },
        { op: "eq", column: "stripe_identity_verified", value: false },
        { op: "eq", column: "stripe_charges_enabled", value: false },
        { op: "eq", column: "stripe_payouts_enabled", value: false },
      ]),
    );
    expect(writes[0].selectCols).toBe("id");
  });

  it("Q870: the transition INTO enabled sends exactly one verified notice", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual(["Payout account verified"]);
  });

  it("Q870: already enabled on file, still enabled: no notice at all (even with requirements due)", async () => {
    onFile({ identity: true, charges: true, payouts: true });
    stripeMock.accounts.retrieve.mockResolvedValue({
      ...ENABLED,
      requirements: { ...NO_REQS, currently_due: ["external_account"] },
    });

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual([]);
  });

  it("Q870: already enabled, only the identity verdict changes: the write runs, no verified notice", async () => {
    onFile({ identity: false, charges: true, payouts: true });
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(cacheWrites()).toHaveLength(1);
    expect(cacheWrites()[0].payload).toMatchObject({ stripe_identity_verified: true });
    expect(noticeTitles()).toEqual([]);
  });

  it("a failed cache write sends no verified notice (the next event still sees the transition)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    scenario.writeErrors.profiles = { message: "boom" };

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual([]);
  });

  it("Q869: the profile snapshot is read BEFORE Stripe is asked (a failed lookup never reaches retrieve)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    scenario.reads.profiles = { rows: [], error: { message: "lookup down" } };

    const res = await deliver(ENABLED);

    expect(res.status).toBe(500);
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(cacheWrites()).toEqual([]);
  });

  it("no profile links the account: acknowledged without asking Stripe", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    scenario.reads.profiles = { rows: [] };

    const res = await deliver(ENABLED);

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(cacheWrites()).toEqual([]);
    expect(noticeTitles()).toEqual([]);
  });

  it("a lost compare-and-set whose winner cached the SAME flags is a quiet 200, no notice", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    scenario.writeSelectRows["profiles:update"] = [];
    scenario.reads.profiles.selectOverrides = [
      {
        includes: "stripe_account_id",
        result: {
          rows: [{
            stripe_account_id: ACCT,
            stripe_identity_verified: true,
            stripe_charges_enabled: true,
            stripe_payouts_enabled: true,
          }],
        },
      },
    ];

    const res = await deliver(ENABLED);

    expect(cacheWrites(), "inventory floor: the CAS write was attempted").toHaveLength(1);
    expect(res.status).toBe(200);
    expect(noticeTitles()).toEqual([]);
  });

  it("a lost compare-and-set whose winner cached DIFFERENT flags answers 500 (Stripe redelivers), no notice", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    scenario.writeSelectRows["profiles:update"] = [];
    scenario.reads.profiles.selectOverrides = [
      {
        includes: "stripe_account_id",
        result: {
          rows: [{
            stripe_account_id: ACCT,
            stripe_identity_verified: true,
            stripe_charges_enabled: true,
            stripe_payouts_enabled: false,
          }],
        },
      },
    ];

    const res = await deliver(ENABLED);

    expect(res.status).toBe(500);
    expect(noticeTitles()).toEqual([]);
  });

  it("an account Stripe no longer has is acknowledged; its cached gate is CLOSED (Q875), scoped to it, no notice", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(
      Object.assign(new Error(`No such account: '${ACCT}'`), { statusCode: 404, code: "account_invalid" }),
    );

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
      expect.arrayContaining([{ op: "eq", column: "stripe_account_id", value: ACCT }]),
    );
    expect(writes[0].selectCols).toBe("id");
    expect(noticeTitles()).toEqual([]);
  });

  it("any other retrieve failure answers 500 and never falls back to the payload", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(
      Object.assign(new Error("Request rate limit exceeded"), { statusCode: 429 }),
    );

    const res = await deliver(ENABLED);

    expect(res.status).toBe(500);
    expect(cacheWrites()).toEqual([]);
    expect(noticeTitles()).toEqual([]);
  });
});
