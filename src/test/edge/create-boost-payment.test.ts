/**
 * Unit tests for the `create-boost-payment` Supabase edge function.
 *
 * The two FREE boost paths are the ones under test here, because they are the
 * two that move a paid entitlement without Stripe ever being involved — so
 * nothing downstream reconciles them and a silent no-op is invisible.
 *
 * The monthly path (Pro 1, Plus 2 — MONTHLY_FREE_BOOSTS) is a spend-then-apply
 * sequence and that ORDER is deliberate: the claim is the conditional UPDATE
 * inside `claim_monthly_free_boost` (20260915043201), which is the only thing
 * stopping two same-moment boosts from both riding the last free credit. It
 * therefore has to happen FIRST. The other half of that bargain — if the boost
 * itself then fails, the credit has to come back through
 * `refund_monthly_free_boost`, or the member loses one of their free boosts
 * with nothing to show for it and no way to say so.
 *
 * The allowance the function passes is asserted per tier, because that
 * argument IS the perk: the SQL holds no tier knowledge, so a Plus member is
 * granted two boosts only if this function says 2.
 *
 * Both paths also lacked the `.select("id")` + zero-row branch CLAUDE.md
 * requires: an UPDATE matching zero rows returns `{ data: [], error: null }`,
 * so the function answered `free: true` and the client showed "Job boosted"
 * over a job that was never boosted.
 *
 * Runs the REAL function source through the edge harness; only Supabase, the
 * shared helpers and the Deno runtime are doubled. Stripe is never reached on
 * these paths (that is the point of them).
 */
//
// Registered mutations - each turns this guard RED on its own:
//   (1) dropping the already-boosted re-check on the flip lets a same-job double
//   request spend two free credits; (2) dropping the Checkout idempotency key
//   lets a double-tap mint two sessions, i.e. two real charges.
// @mutate supabase/functions/create-boost-payment/index.ts |         .or(`boost_expires_at.is.null,boost_expires_at.lte.${flipAt}`) | 
// @mutate supabase/functions/create-boost-payment/index.ts | create(sessionParams, {\n      idempotencyKey: `boost:${user.id}:${job_id}:${paramsDigest}`,\n    }); | create(sessionParams);
//   (3) ME-017 #8: a key that ignores the params makes a retry after a plan
//   change hit Stripe's idempotency-mismatch error.
// @mutate supabase/functions/create-boost-payment/index.ts | idempotencyKey: `boost:${user.id}:${job_id}:${paramsDigest}`, | idempotencyKey: `boost:${user.id}:${job_id}`,
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";

const USER_ID = "user-boost-1";
const JOB_ID = "job-boost-1";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_boost",
  });
  return loadEdgeFunction("create-boost-payment");
}

function call(fn: EdgeHarness) {
  return fn.request({
    headers: { Authorization: "Bearer user-jwt" },
    body: { job_id: JOB_ID },
  });
}

async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}

/** An open job owned by the caller, and a profile on the given tier. */
function seed(tier: string) {
  scenario.authUser = { id: USER_ID, email: "boost@test.dev" };
  scenario.reads.jobs = {
    rows: [
      {
        id: JOB_ID,
        customer_id: USER_ID,
        status: "open",
        title: "Mow the lawn",
        boost_expires_at: null,
      },
    ],
  };
  // A year out, so `subActive` is true for every tier under test.
  scenario.reads.profiles = {
    rows: [
      {
        subscription_tier: tier,
        subscription_expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      },
    ],
  };
}

/** Every write this run made against `jobs`. */
function jobWrites() {
  return scenario.writes.filter((w) => w.table === "jobs");
}

/** Every write this run made against `profiles`. */
function profileWrites() {
  return scenario.writes.filter((w) => w.table === "profiles");
}

describe("create-boost-payment — Elite free boost", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("applies the boost and reports free:true when the flip matches a row", async () => {
    seed("elite");
    const fn = await load();
    const body = await json(await fn.fetch(call(fn)));

    expect(body.free).toBe(true);
    expect(body.boost_expires_at).toEqual(expect.any(String));
    const flips = jobWrites();
    expect(flips).toHaveLength(1);
    expect(flips[0].payload).toMatchObject({
      boost_expires_at: expect.any(String),
      boosted_at: expect.any(String),
    });
  });

  it("projects a real column on the flip so the row count is knowable", async () => {
    // The mock hands back seeded rows REGARDLESS of projection, so a behavioural
    // assertion alone passes on a `.select()` that was never added. Assert the
    // projection itself — `jobs.id` is a real column.
    seed("elite");
    const fn = await load();
    await fn.fetch(call(fn));

    expect(jobWrites()[0].selectCols).toBe("id");
  });

  it("does NOT report free:true when the boost flip matches zero rows", async () => {
    // The negative control for the `.select("id")` guard. A zero-row UPDATE is
    // `{ data: [], error: null }` — without the guard this answered 200
    // `free: true` and the client showed "Job boosted".
    seed("elite");
    scenario.writeSelectRows["jobs"] = [];
    const fn = await load();
    const res = await fn.fetch(call(fn));
    const body = await json(res);

    expect(res.status).toBe(500);
    expect(body.free).toBeUndefined();
    expect(body.error).toMatch(/couldn't apply/i);
  });
});

const THIS_MONTH = () => new Date().toISOString().slice(0, 7);

/** Answer claim_monthly_free_boost the way PostgREST does (RETURNS TABLE → array). */
function claimAnswers(claimed: boolean, used: number | null = claimed ? 1 : null) {
  scenario.rpc.claim_monthly_free_boost = () => {
    // Record how many jobs writes existed at claim time — the ORDER assertion.
    claimSeenJobWrites.push(jobWrites().length);
    return [{ claimed, credit_month: THIS_MONTH(), credits_used: used }];
  };
}
let claimSeenJobWrites: number[] = [];

function rpcCallsNamed(name: string) {
  return (scenario.rpcCalls ?? []).filter((c) => c.name === name);
}

describe("create-boost-payment — monthly free boost allowance", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
    claimSeenJobWrites = [];
  });

  it("spends the credit BEFORE applying the boost (the race guard)", async () => {
    seed("pro");
    claimAnswers(true);
    const fn = await load();
    const body = await json(await fn.fetch(call(fn)));

    expect(body.free).toBe(true);
    expect(rpcCallsNamed("claim_monthly_free_boost")).toHaveLength(1);
    // Zero jobs writes existed when the claim ran; one exists after.
    expect(claimSeenJobWrites).toEqual([0]);
    expect(jobWrites()).toHaveLength(1);
  });

  it.each([
    ["pro", 1],
    ["plus", 2],
  ])("passes %s's allowance (%i) — the number the storefront sells", async (tier, allowance) => {
    seed(tier);
    claimAnswers(true);
    const fn = await load();
    await fn.fetch(call(fn));

    expect(rpcCallsNamed("claim_monthly_free_boost")[0].args).toEqual({
      p_user_id: USER_ID,
      p_allowance: allowance,
    });
  });

  it("gives Plus MORE free boosts than Pro (owner, VN-44)", async () => {
    seed("pro");
    claimAnswers(true);
    let fn = await load();
    await fn.fetch(call(fn));
    const pro = (rpcCallsNamed("claim_monthly_free_boost")[0].args as { p_allowance: number }).p_allowance;

    resetSupabaseMock();
    seed("plus");
    claimAnswers(true);
    fn = await load();
    await fn.fetch(call(fn));
    const plus = (rpcCallsNamed("claim_monthly_free_boost")[0].args as { p_allowance: number }).p_allowance;

    expect(plus).toBeGreaterThan(pro);
  });

  it("names the count on a multi-boost tier", async () => {
    seed("plus");
    claimAnswers(true, 2);
    const fn = await load();
    const body = await json(await fn.fetch(call(fn)));
    expect(body.message).toMatch(/2 of 2 this month/);
  });

  it("does not claim for a lapsed member or a tier without the perk", async () => {
    for (const tier of ["basic", "free"]) {
      resetSupabaseMock();
      seed(tier);
      claimAnswers(true);
      const fn = await load();
      await fn.fetch(call(fn));
      expect(rpcCallsNamed("claim_monthly_free_boost"), tier).toHaveLength(0);
    }
    resetSupabaseMock();
    seed("plus");
    (scenario.reads.profiles.rows![0] as Record<string, unknown>).subscription_expires_at =
      new Date(Date.now() - 86_400_000).toISOString();
    claimAnswers(true);
    const fn = await load();
    await fn.fetch(call(fn));
    expect(rpcCallsNamed("claim_monthly_free_boost")).toHaveLength(0);
  });

  it("an exhausted allowance applies no free boost", async () => {
    seed("plus");
    claimAnswers(false);
    const fn = await load();
    const body = await json(await fn.fetch(call(fn)));

    expect(body.free).toBeUndefined();
    expect(jobWrites()).toHaveLength(0);
    expect(rpcCallsNamed("refund_monthly_free_boost")).toHaveLength(0);
  });

  it("an unreadable claim answer is not a grant", async () => {
    seed("plus");
    scenario.rpc.claim_monthly_free_boost = [{}];
    const fn = await load();
    const body = await json(await fn.fetch(call(fn)));

    expect(body.free).toBeUndefined();
    expect(jobWrites()).toHaveLength(0);
  });

  it("RETURNS the credit when the boost flip matches zero rows", async () => {
    // The credit is already spent by the time the flip runs, so a failed flip
    // that does not roll back destroys one of the member's free boosts.
    seed("plus");
    claimAnswers(true, 2);
    scenario.rpc.refund_monthly_free_boost = true;
    scenario.writeSelectRows["jobs"] = [];
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(500);
    const refunds = rpcCallsNamed("refund_monthly_free_boost");
    expect(refunds).toHaveLength(1);
    // Conditional on the month the claim was made in.
    expect(refunds[0].args).toEqual({ p_user_id: USER_ID, p_month: THIS_MONTH() });
  });

  it("the flip re-checks open + not-already-boosted, so a same-job double request cannot spend two credits", async () => {
    seed("plus");
    claimAnswers(true);
    const fn = await load();
    await fn.fetch(call(fn));

    const flip = jobWrites()[0];
    expect(flip.filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "id", value: JOB_ID },
        { op: "eq", column: "status", value: "open" },
      ]),
    );
    const or = flip.filters.find((f: { op: string }) => f.op === "or") as { value?: string } | undefined;
    expect(or?.value ?? JSON.stringify(or)).toMatch(/boost_expires_at\.is\.null,boost_expires_at\.lte\./);
  });

  it("does not refund the credit on a successful boost", async () => {
    seed("pro");
    claimAnswers(true);
    const fn = await load();
    const body = await json(await fn.fetch(call(fn)));

    expect(body.free).toBe(true);
    expect(rpcCallsNamed("refund_monthly_free_boost")).toHaveLength(0);
    // The meter is never written through PostgREST while the RPC exists.
    expect(profileWrites()).toHaveLength(0);
  });

  describe("PGRST202 fallback — this function deployed before its migration", () => {
    it("falls back to the one-credit month stamp, conditional as before", async () => {
      seed("pro");
      scenario.rpcErrors = {
        claim_monthly_free_boost: { message: "function not found", code: "PGRST202" },
      };
      const fn = await load();
      const body = await json(await fn.fetch(call(fn)));

      expect(body.free).toBe(true);
      const claim = profileWrites()[0];
      expect(claim.op).toBe("update");
      expect(claim.payload).toEqual({ boost_credit_used_month: THIS_MONTH() });
      expect(claim.selectCols).toBe("user_id");
      expect(scenario.writes.indexOf(claim)).toBeLessThan(scenario.writes.indexOf(jobWrites()[0]));
    });

    it("rolls the legacy stamp back when the flip fails", async () => {
      seed("pro");
      scenario.rpcErrors = {
        claim_monthly_free_boost: { message: "function not found", code: "PGRST202" },
        refund_monthly_free_boost: { message: "function not found", code: "PGRST202" },
      };
      scenario.writeSelectRows["jobs"] = [];
      const fn = await load();
      const res = await fn.fetch(call(fn));

      expect(res.status).toBe(500);
      const writes = profileWrites();
      expect(writes).toHaveLength(2);
      expect(writes[1].payload).toEqual({ boost_credit_used_month: null });
      expect(writes[1].filters).toEqual(
        expect.arrayContaining([
          { op: "eq", column: "user_id", value: USER_ID },
          { op: "eq", column: "boost_credit_used_month", value: THIS_MONTH() },
        ]),
      );
    });

    it("a claim error that is NOT a missing function fails toward the paid path", async () => {
      seed("plus");
      scenario.rpcErrors = { claim_monthly_free_boost: { message: "boom", code: "XX000" } };
      const fn = await load();
      const body = await json(await fn.fetch(call(fn)));

      expect(body.free).toBeUndefined();
      expect(jobWrites()).toHaveLength(0);
      expect(profileWrites()).toHaveLength(0);
    });
  });
});

/**
 * The PAID path — untested until 2026-09-21, and the probe that found the gap
 * deleted the Stripe `idempotencyKey` outright and left this file 17/17 GREEN.
 * That option is the ONLY thing standing between a double-tap on "Boost" and
 * two Checkout Sessions, i.e. two real charges; nothing downstream de-dupes a
 * boost payment, because the webhook happily applies whichever session pays.
 */
describe("create-boost-payment — the PAID Stripe Checkout path", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("keys the Checkout Session on boost:<user>:<job>, and stamps the metadata the webhook boosts from", async () => {
    seed("free");
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_boost" }] });
    stripeMock.checkout.sessions.create.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_boost",
    });

    const fn = await load();
    const res = await fn.fetch(call(fn));
    expect(res.status).toBe(200);
    expect((await json(res)).url).toBe("https://checkout.stripe.com/c/pay/cs_test_boost");

    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0] as [
      Record<string, any>,
      { idempotencyKey?: string } | undefined,
    ];
    // Same user + same job = same key, so Stripe replays the first session
    // rather than minting a second one a second tap could also pay.
    expect(opts?.idempotencyKey).toMatch(new RegExp(`^boost:${USER_ID}:${JOB_ID}:[0-9a-f]{16}$`));
    // A session that pays but does not say WHICH job it boosts charges the
    // poster and boosts nothing — stripe-webhook routes on exactly these keys.
    expect(params.metadata).toMatchObject({
      kind: "job_boost",
      job_id: JOB_ID,
      customer_id: USER_ID,
    });
    expect(params.payment_intent_data?.metadata).toMatchObject({
      kind: "job_boost",
      job_id: JOB_ID,
    });
  });

  // ME-043: automatic_tax needs a tax location. An existing addressless
  // customer made Stripe refuse the session until the collected address was
  // saved; customer_update is invalid without a customer, so only then.
  it("saves the Checkout address for an existing customer, and never sends customer_update without one", async () => {
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_addr" });
    seed("free");
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_boost" }] });
    let fn = await load();
    await fn.fetch(call(fn));
    let params = stripeMock.checkout.sessions.create.mock.calls[0][0] as Record<string, any>;
    expect(params.automatic_tax).toEqual({ enabled: true });
    expect(params.customer_update).toEqual({ address: "auto" });
    expect(params.line_items[0].price_data.tax_behavior).toBe("exclusive");

    resetSupabaseMock();
    seed("free");
    stripeMock.customers.list.mockResolvedValue({ data: [] });
    fn = await load();
    await fn.fetch(call(fn));
    params = stripeMock.checkout.sessions.create.mock.calls[1][0] as Record<string, any>;
    expect(params.customer).toBeUndefined();
    expect(params.customer_update).toBeUndefined();
  });

  it("same request = same key; a changed plan gets a new key instead of Stripe's mismatch error (ME-017 #8)", async () => {
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_boost" }] });
    stripeMock.checkout.sessions.create.mockResolvedValue({ url: "https://checkout.stripe.com/c/pay/cs_x" });
    const keyFor = async (tier: string) => {
      resetSupabaseMock();
      seed(tier);
      const fn = await load();
      await fn.fetch(call(fn));
      const calls = stripeMock.checkout.sessions.create.mock.calls;
      return (calls[calls.length - 1][1] as { idempotencyKey: string }).idempotencyKey;
    };
    const free1 = await keyFor("free");
    const free2 = await keyFor("free");
    const paid = await keyFor("basic");
    expect(free1).toBe(free2);
    expect(paid).not.toBe(free1);
  });
});
