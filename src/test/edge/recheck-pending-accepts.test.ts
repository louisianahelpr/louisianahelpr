/**
 * Q1186: a pending accept completes without the Helpr coming back to the app.
 *
 * accept_job_offer parks an accept in job_accept_pending while the Helpr's
 * payout setup or Stripe ID is unfinished; trg_profiles_complete_pending_accepts
 * completes it when the cached gate columns on profiles open. Prod's webhook
 * receives no Connect events (Q876: 0 account.* rows in stripe_webhook_events,
 * re-measured 2026-10-06), so before this the ONLY writer of those columns was
 * the Helpr's own stripe-connect `status` call: a Helpr who finished Stripe and
 * never reopened the app lost the offer at its deadline.
 *
 * Now cron job recheck-pending-accepts calls the recheck-pending-accepts edge
 * function with the service key, and every waiting Helpr's account is re-read
 * and synced through the same writer the `status` call uses
 * (_shared/connectGateSync.ts).
 *
 * @mutate supabase/functions/recheck-pending-accepts/index.ts |   const denied = verifyCronSecret(req);\n  if (denied) return denied; |   const denied = null;
 * @mutate supabase/functions/_shared/connectGateSync.ts |     const gate = await syncConnectGate(stripe, supabaseAdmin, p.user_id, p, account); |     const gate = { kind: "synced" as const, opened: false, writeError: null };
 * @mutate supabase/functions/_shared/connectGateSync.ts |       if (isTestObjectUnderLiveKey(e) \|\| isUnusableConnectAccountError(e)) { |       if (false) {
 * @mutate supabase/functions/_shared/connectGateSync.ts |     .filter((p) => !(p.stripe_payouts_enabled === true && p.stripe_identity_verified === true)); |     ;
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const HELPR = "helpr-1186";
const ACCT = "acct_1186_live";
const NO_REQS = { currently_due: [], eventually_due: [], past_due: [], errors: [] };
const ENABLED = {
  id: ACCT,
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { transfers: "active" },
  requirements: NO_REQS,
};
const WAITING_PROFILE = {
  user_id: HELPR,
  stripe_account_id: ACCT,
  stripe_identity_verified: false,
  stripe_charges_enabled: false,
  stripe_payouts_enabled: false,
};

const profileUpdates = () => scenario.writes.filter((w) => w.table === "profiles" && w.op === "update");

async function cron(bearer = "service-key") {
  const fn = await loadEdgeFunction("recheck-pending-accepts");
  return fn.fetch(fn.request({
    url: "https://edge.test/recheck-pending-accepts",
    headers: { Authorization: `Bearer ${bearer}` },
    body: {},
  }));
}

describe("Q1186: recheck-pending-accepts re-checks Helprs whose accept waits on setup", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_live_x",
    });
    scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR }, { helper_id: HELPR }] };
    scenario.reads.profiles = { rows: [WAITING_PROFILE] };
    scenario.reads.payment_method_fingerprints = { rows: [] };
  });
  afterEach(() => resetEnv());

  it("a Helpr who finished Stripe has the gate opened from Stripe's answer (the write the accept trigger waits on)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ fn: "recheck-pending-accepts", waiting: 1, checked: 1, opened: 1, defects: 0 });
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(1);
    const writes = profileUpdates();
    expect(writes, "inventory floor: the sync wrote the gate").toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ stripe_payouts_enabled: true, stripe_identity_verified: true });
    // The same compare-and-set the status call runs, scoped to this account.
    expect(writes[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "user_id", value: HELPR }),
      expect.objectContaining({ column: "stripe_account_id", value: ACCT }),
      expect.objectContaining({ column: "stripe_payouts_enabled", value: false }),
    ]));
  });

  it("only the schedule may run it: a user token is refused and nothing is read", async () => {
    const res = await cron("some-user-jwt");

    expect(res.status).toBe(401);
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
    expect(profileUpdates()).toEqual([]);
  });

  it("no accept waiting: no Stripe read, a clean run", async () => {
    scenario.reads.job_accept_pending = { rows: [] };

    const res = await cron();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ waiting: 0, checked: 0 });
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("a Helpr whose gate is already open is not re-read", async () => {
    scenario.reads.profiles = { rows: [{ ...WAITING_PROFILE, stripe_payouts_enabled: true, stripe_identity_verified: true }] };

    const res = await cron();

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("a test-mode account under the live key is skipped, not a defect", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(
      new Error(`The account ${ACCT} was a test account created with a testmode key, and therefore can only be used with testmode keys.`),
      { type: "StripeInvalidRequestError", statusCode: 400 },
    ));

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ checked: 0, skipped: 1, defects: 0 });
    expect(profileUpdates()).toEqual([]);
  });

  it("a Stripe read that fails for another reason is a defect (500), and nothing is written", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(new Error("stripe 503"));

    const res = await cron();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(JSON.stringify(body.defectReasons)).toContain("could not be read");
    expect(profileUpdates()).toEqual([]);
  });

  it("an unreadable pending list is a defect, not a silent clean run", async () => {
    scenario.reads.job_accept_pending = { error: { message: "boom", code: "XX000" } };

    const res = await cron();

    expect(res.status).toBe(500);
    expect(stripeMock.accounts.retrieve).not.toHaveBeenCalled();
  });
});
