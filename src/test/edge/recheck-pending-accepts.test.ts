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
 * @mutate supabase/functions/_shared/connectGateSync.ts |   const nowPayouts = account.payouts_enabled === true && !rejected; |   const nowPayouts = account.payouts_enabled === true;
 * @mutate supabase/functions/_shared/connectGateSync.ts |       const knownClosed = isRejectedAccountError(e) \|\| isUnusableConnectAccountError(e); |       const knownClosed = false;
 * @mutate supabase/functions/recheck-pending-accepts/index.ts |     if (platformRejectedThisRun > 0) { |     if (false) {
 * @mutate supabase/functions/recheck-pending-accepts/index.ts |     const platformRejectedThisRun = refresh.platform_rejected + counts.platform_rejected; |     const platformRejectedThisRun = refresh.platform_rejected;
 * @mutate supabase/functions/recheck-pending-accepts/index.ts |     const closedThisRun = refresh.closed + counts.closed; |     const closedThisRun = refresh.closed;
 * @mutate supabase/functions/_shared/connectGateSync.ts |     if (skip.has(p.user_id)) continue; |     ;
 * @mutate supabase/functions/_shared/livePayoutGate.ts |     .update({ stripe_charges_enabled: false, stripe_payouts_enabled: false }) |     .update({ stripe_charges_enabled: false, stripe_payouts_enabled: true })
 * @mutate supabase/functions/recheck-pending-accepts/index.ts |     if (closedThisRun > 0) { |     if (false) {
 *
 * Lead, 2026-10-23: the same run then refreshes EVERY Helpr with a Connect
 * account (refreshAllConnectGates), because Stripe rejected the platform and
 * every connected account while 13 of 34 cached gates still read payable.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
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

/** The refresh pass's own profiles read (refreshAllConnectGates selects "stripe_account_id, user_id, ..."). */
const REFRESH_SELECT = "stripe_account_id, user_id";
/** profiles for the pending-accept pass, and (default none) for the all-accounts refresh. */
function profilesRead(rows: Record<string, unknown>[], refreshRows: Record<string, unknown>[] = []) {
  return { rows, selectOverrides: [{ includes: REFRESH_SELECT, result: { rows: refreshRows } }] };
}

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
    scenario.reads.profiles = profilesRead([WAITING_PROFILE]);
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
    scenario.reads.profiles = profilesRead([{ ...WAITING_PROFILE, stripe_payouts_enabled: true, stripe_identity_verified: true }]);

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

describe("lead 2026-10-23: every Connect account's cached gate follows Stripe (refreshAllConnectGates)", () => {
  const PAYABLE_CACHE = {
    user_id: HELPR,
    stripe_account_id: ACCT,
    stripe_identity_verified: true,
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
  };
  const REJECTED = {
    ...ENABLED,
    charges_enabled: false,
    payouts_enabled: false,
    capabilities: { transfers: "inactive" },
    requirements: { ...NO_REQS, disabled_reason: "rejected.other" },
  };
  const rejectedError = () => Object.assign(
    new Error("An account link cannot be created for this account because the account has been rejected. Check the status of the account in your Stripe dashboard."),
    { type: "StripeInvalidRequestError", statusCode: 400 },
  );

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
    scenario.reads.job_accept_pending = { rows: [] };
    scenario.reads.profiles = profilesRead([], [PAYABLE_CACHE]);
    scenario.reads.payment_method_fingerprints = { rows: [] };
  });
  afterEach(() => resetEnv());

  it("a Helpr who never opens the app: Stripe says rejected, the cached gate closes and ops hear once", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(REJECTED);

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.refresh).toMatchObject({ accounts: 1, checked: 1, closed: 1, opened: 0, cannot_verify: 0 });
    const writes = profileUpdates();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toMatchObject({ stripe_charges_enabled: false, stripe_payouts_enabled: false });
    expect(writes[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "user_id", value: HELPR }),
      expect.objectContaining({ column: "stripe_account_id", value: ACCT }),
    ]));
    const alert = (slackAlerts as Array<{ oncePerDayKey?: string; fields?: Record<string, unknown> }>)
      .find((a) => a.oncePerDayKey === "connect-gates-closed");
    expect(alert?.fields).toMatchObject({ closed: 1 });
  });

  it("an account whose flags still read enabled but Stripe rejected it is never cached payable", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue({ ...ENABLED, requirements: { ...NO_REQS, disabled_reason: "rejected.fraud" } });

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.refresh).toMatchObject({ closed: 1 });
    expect(profileUpdates()[0].payload).toMatchObject({ stripe_charges_enabled: false, stripe_payouts_enabled: false });
  });

  it("a read Stripe refuses with \"has been rejected\" closes the cached gate, towards false only", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(rejectedError());

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.refresh).toMatchObject({ checked: 1, closed: 1, cannot_verify: 0 });
    const writes = profileUpdates();
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({ stripe_charges_enabled: false, stripe_payouts_enabled: false });
    // Only a row that still points at this account and still reads open.
    expect(writes[0].filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "stripe_account_id", value: ACCT }),
      expect.objectContaining({ op: "or", value: "stripe_charges_enabled.eq.true,stripe_payouts_enabled.eq.true" }),
    ]));
  });

  it("Stripe refusing OUR platform (\"your account has been rejected\") is \"cannot verify\": nothing written, no defect, ops told once a day", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(
      new Error("You cannot create new accounts because your account has been rejected."),
      { type: "StripeInvalidRequestError", statusCode: 400 },
    ));

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.refresh).toMatchObject({ checked: 0, closed: 0, platform_rejected: 1, cannot_verify: 0 });
    expect(profileUpdates()).toEqual([]);
    expect((slackAlerts as Array<{ oncePerDayKey?: string }>).some((a) => a.oncePerDayKey === "connect-refresh-platform-rejected")).toBe(true);
  });

  it("a test-mode object under the live key is skipped, not a standing defect", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(
      new Error(`No such account: '${ACCT}'; a similar object exists in test mode, but a live mode key was used to make this request.`),
      { type: "StripeInvalidRequestError", statusCode: 404 },
    ));

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.refresh).toMatchObject({ skipped: 1, closed: 0, cannot_verify: 0 });
    expect(profileUpdates()).toEqual([]);
  });

  it("the pending-accept pass: a rejected account closes its cached gate and is not a defect", async () => {
    scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR }] };
    scenario.reads.profiles = profilesRead([{ ...PAYABLE_CACHE, stripe_identity_verified: false }], [PAYABLE_CACHE]);
    stripeMock.accounts.retrieve.mockRejectedValue(rejectedError());

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ skipped: 1 });
    // Read once: the refresh skips a Helpr the pending pass already asked about.
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(1);
    expect(profileUpdates().map((u) => u.payload)).toEqual([{ stripe_charges_enabled: false, stripe_payouts_enabled: false }]);
    // ...and the pending pass's close still reaches the run's alert.
    const alert = (slackAlerts as Array<{ oncePerDayKey?: string; fields?: Record<string, unknown> }>)
      .find((a) => a.oncePerDayKey === "connect-gates-closed");
    expect(alert?.fields).toMatchObject({ closed: 1 });
  });

  it("the pending-accept pass: a platform refusal still raises the run's platform alert", async () => {
    scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR }] };
    scenario.reads.profiles = profilesRead([{ ...PAYABLE_CACHE, stripe_identity_verified: false }], [PAYABLE_CACHE]);
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(
      new Error("You cannot create new accounts because your account has been rejected."),
      { type: "StripeInvalidRequestError", statusCode: 400 },
    ));

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body).toMatchObject({ skipped: 1, platform_rejected: 1 });
    expect(profileUpdates()).toEqual([]);
    expect((slackAlerts as Array<{ oncePerDayKey?: string }>).some((a) => a.oncePerDayKey === "connect-refresh-platform-rejected")).toBe(true);
  });

  it("any other failed read is \"cannot verify\": a defect, and nothing is written (never read as enabled)", async () => {
    stripeMock.accounts.retrieve.mockRejectedValue(Object.assign(new Error("stripe 503"), { statusCode: 503 }));

    const res = await cron();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.refresh).toMatchObject({ checked: 0, closed: 0, cannot_verify: 1 });
    expect(JSON.stringify(body.defectReasons)).toContain("could not be verified");
    expect(profileUpdates()).toEqual([]);
  });

  it("a payable account stays payable and nobody is paged", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.refresh).toMatchObject({ checked: 1, closed: 0 });
    expect((slackAlerts as Array<{ oncePerDayKey?: string }>).some((a) => a.oncePerDayKey === "connect-gates-closed")).toBe(false);
  });

  it("a Helpr the pending-accept pass already re-read is not read twice in one run", async () => {
    scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR }] };
    scenario.reads.profiles = profilesRead([WAITING_PROFILE], [WAITING_PROFILE]);
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);

    const res = await cron();
    const body = await res.json();

    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(stripeMock.accounts.retrieve).toHaveBeenCalledTimes(1);
    expect(body.refresh).toMatchObject({ accounts: 1, checked: 0 });
  });
});
