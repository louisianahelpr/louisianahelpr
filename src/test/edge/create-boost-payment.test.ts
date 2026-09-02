/**
 * Unit tests for the `create-boost-payment` Supabase edge function.
 *
 * The two FREE boost paths are the ones under test here, because they are the
 * two that move a paid entitlement without Stripe ever being involved — so
 * nothing downstream reconciles them and a silent no-op is invisible.
 *
 * The Pro path is a spend-then-apply sequence and that ORDER is deliberate:
 * the month stamp is a conditional UPDATE
 * (`.eq(user_id).or(boost_credit_used_month is null or != thisMonth)`), which
 * is the only thing stopping two same-moment boosts from both riding one free
 * credit. It therefore has to be written FIRST. What was missing is the other
 * half of that bargain — if the boost itself then fails, the credit has to come
 * back, or the member has paid for a month of Pro and lost their one free boost
 * with nothing to show for it and no way to say so.
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
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { resetStripeMock } from "./mocks/stripe";

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

describe("create-boost-payment — Pro free monthly boost", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    resetEnv();
  });

  it("spends the month credit BEFORE applying the boost (the race guard)", async () => {
    seed("pro");
    const fn = await load();
    await fn.fetch(call(fn));

    // The claim must be first, and it must be conditional — otherwise two
    // same-moment boosts both ride one credit.
    const claim = profileWrites()[0];
    expect(claim.op).toBe("update");
    expect(claim.payload).toMatchObject({
      boost_credit_used_month: new Date().toISOString().slice(0, 7),
    });
    expect(claim.selectCols).toBe("user_id");
    expect(scenario.writes.indexOf(claim)).toBeLessThan(
      scenario.writes.indexOf(jobWrites()[0]),
    );
  });

  it("RETURNS the month credit when the boost flip matches zero rows", async () => {
    // The defect this test exists for: the credit is already spent by the time
    // the flip runs, so a failed flip that does not roll back destroys the
    // member's one free boost of the month.
    seed("pro");
    scenario.writeSelectRows["jobs"] = [];
    const fn = await load();
    const res = await fn.fetch(call(fn));

    expect(res.status).toBe(500);

    const writes = profileWrites();
    expect(writes).toHaveLength(2);
    // Second profiles write is the rollback: the month is nulled back out.
    expect(writes[1].payload).toEqual({ boost_credit_used_month: null });
    // Conditional on the exact value we stamped, so a concurrent writer that
    // has since moved the column on is not clobbered.
    expect(writes[1].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", column: "user_id", value: USER_ID },
        {
          op: "eq",
          column: "boost_credit_used_month",
          value: new Date().toISOString().slice(0, 7),
        },
      ]),
    );
    expect(writes[1].selectCols).toBe("user_id");
  });

  it("does not roll back the credit on a successful boost", async () => {
    seed("pro");
    const fn = await load();
    const body = await json(await fn.fetch(call(fn)));

    expect(body.free).toBe(true);
    // Exactly one profiles write: the claim. No rollback.
    expect(profileWrites()).toHaveLength(1);
  });
});
