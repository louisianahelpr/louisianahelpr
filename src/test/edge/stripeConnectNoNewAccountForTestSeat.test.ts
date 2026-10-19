/**
 * nightly-red #2436: a shared TEST ACCOUNT never gets a new Stripe Connect
 * account from stripe-connect, and never has its account deleted and replaced.
 *
 * Twice a local node script called stripe-connect `onboard` while signed in as
 * a shared seat. On 2026-10-15 it was helper-e2e (acct_1UQigP...). On
 * 2026-10-18 18:55Z it was eli.test.helper 5af6ce6d (acct_1URzEe..., a lane's
 * declutter payout proof). Both times stripe-connect created and linked a
 * half-onboarded test-mode Express account. That made the seat a
 * `pending_setup` Helpr, and every hiring journey failed its seat precondition
 * (scripts/e2e/seatStripeAccounts.mjs).
 *
 * A seat is what stripeMode.ts calls a TEST ACCOUNT (public.test_accounts row
 * AND profiles.is_seed). The ONE sanctioned seat account (helper-e2e's
 * fixture) is already linked, and a create never returns it, so:
 *   - `onboard` for a seat with no account on file is refused (403) before
 *     accounts.create, and nothing is linked;
 *   - `reset` for a seat is refused before accounts.del, so the fixture is
 *     never deleted;
 *   - `onboard` for a seat that already holds its account still answers with an
 *     Account Link and creates nothing (the fixture keeps working);
 *   - a real (non-enrolled) caller still gets an account created (the refusal
 *     is scoped to seats, not a blanket stop);
 *   - the App Store review account (enrolled is_seed, exempt by id) can still
 *     onboard in TEST mode, so Apple's reviewer can reach "Set up payouts".
 *
 * Runs the REAL function source through the edge harness (Stripe and
 * Supabase are doubled; nothing here reaches Stripe).
 *
 * @mutate supabase/functions/stripe-connect/index.ts | if (callerIsTestSeat) throw new TestSeatConnectRefused(user.id, "accounts.create"); | if (false) throw new TestSeatConnectRefused(user.id, "accounts.create");
 * @mutate supabase/functions/stripe-connect/index.ts | if (callerIsTestSeat) throw new TestSeatConnectRefused(user.id, "reset"); | if (false) throw new TestSeatConnectRefused(user.id, "reset");
 * @mutate supabase/functions/stripe-connect/index.ts | const callerIsTestSeat = callerMode === "test" && !APP_REVIEW_ACCOUNT_IDS.has(user.id); | const callerIsTestSeat = false;
 * @mutate supabase/functions/stripe-connect/index.ts | const callerIsTestSeat = callerMode === "test" && !APP_REVIEW_ACCOUNT_IDS.has(user.id); | const callerIsTestSeat = callerMode === "test";
 * @mutate supabase/functions/stripe-connect/index.ts | status: 403,\n      });\n    }\n | status: 500,\n      });\n    }\n
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { stripeMock, resetStripeMock } from "./mocks/stripe";

const SEAT = { id: "5af6ce6d-68a8-4f98-b9d4-4fab20f1a607", email: "seat@example.test" };
const APP_REVIEWER = { id: "f2098932-5563-47c3-9589-1d22cca72003", email: "apple-reviewer@example.test" };
const REAL = { id: "44444444-4444-4444-8444-444444444444", email: "real@example.test" };
const NEW_ACCT = "acct_new_from_create";
const FIXTURE_ACCT = "acct_fixture_on_file";
const RETURN_URL = "https://louisianahelpr.com/profile";

/** Enrol `id` as a TEST ACCOUNT: a test_accounts row AND profiles.is_seed. */
function enrol(id: string) {
  scenario.reads.test_accounts = { rows: [{ user_id: id }] };
  scenario.reads.profiles = {
    ...(scenario.reads.profiles ?? {}),
    selectOverrides: [
      { includes: "user_id, is_seed", result: { rows: [{ user_id: id, is_seed: true }] } },
      ...(scenario.reads.profiles?.selectOverrides ?? []),
    ],
  };
}

const profileLinks = () =>
  scenario.writes.filter(
    (w) => w.table === "profiles" && w.op === "update" &&
      typeof (w.payload as Record<string, unknown>)?.stripe_account_id === "string",
  );
const profileWrites = () => scenario.writes.filter((w) => w.table === "profiles");

async function call(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("stripe-connect");
  return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body }));
}

describe("#2436 stripe-connect never gives a shared test seat a new Connect account", () => {
  beforeEach(() => {
    resetSupabaseMock();
    resetSharedMocks();
    resetStripeMock();
    setEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "service-key",
      STRIPE_SECRET_KEY: "sk_live_real_money",
      STRIPE_TEST_SECRET_KEY: "sk_test_sandbox",
    });
    scenario.reads.test_accounts = { rows: [] };
    scenario.reads.error_logs = { rows: [], count: 0 };
    stripeMock.accounts.create.mockResolvedValue({ id: NEW_ACCT });
    stripeMock.accounts.retrieve.mockResolvedValue({ id: NEW_ACCT });
    stripeMock.accounts.del.mockResolvedValue({ id: FIXTURE_ACCT, deleted: true });
    stripeMock.accountLinks.create.mockResolvedValue({ url: "https://connect.stripe.test/onboard" });
  });
  afterEach(() => resetEnv());

  it("onboard for a seat with no account is refused before accounts.create, and nothing is linked", async () => {
    scenario.authUser = SEAT;
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Eli Test" }] };
    enrol(SEAT.id);

    const res = await call({ action: "onboard", return_url: RETURN_URL });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.reason).toBe("test_seat_no_new_connect_account");
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(stripeMock.accountLinks.create).not.toHaveBeenCalled();
    expect(profileLinks()).toEqual([]);
  });

  it("reset for a seat is refused before anything is deleted at Stripe or written", async () => {
    scenario.authUser = SEAT;
    scenario.reads.profiles = { rows: [{ stripe_account_id: FIXTURE_ACCT }] };
    enrol(SEAT.id);

    const res = await call({ action: "reset", return_url: RETURN_URL });

    expect(res.status).toBe(403);
    expect(stripeMock.accounts.del).not.toHaveBeenCalled();
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(profileWrites()).toEqual([]);
  });

  it("onboard for a seat that already holds its account still returns a link and creates nothing", async () => {
    scenario.authUser = SEAT;
    scenario.reads.profiles = { rows: [{ stripe_account_id: FIXTURE_ACCT }] };
    enrol(SEAT.id);

    const res = await call({ action: "onboard", return_url: RETURN_URL });

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).not.toHaveBeenCalled();
    expect(stripeMock.accountLinks.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.accountLinks.create.mock.calls[0][0]).toMatchObject({ account: FIXTURE_ACCT });
  });

  it("the App Store review account (an enrolled test account) can still onboard, on the TEST key", async () => {
    scenario.authUser = APP_REVIEWER;
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "App Review" }] };
    enrol(APP_REVIEWER.id);

    const res = await call({ action: "onboard", return_url: RETURN_URL });

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.__keys, "the reviewer stays in TEST mode").toContain("sk_test_sandbox");
    expect(stripeMock.__keys).not.toContain("sk_live_real_money");
    expect(profileLinks().map((w) => (w.payload as Record<string, unknown>).stripe_account_id)).toEqual([NEW_ACCT]);
  });

  it("a real (non-enrolled) caller still gets an account created and linked", async () => {
    scenario.authUser = REAL;
    scenario.reads.profiles = { rows: [{ stripe_account_id: null, full_name: "Real Person" }] };

    const res = await call({ action: "onboard", return_url: RETURN_URL });

    expect(res.status).toBe(200);
    expect(stripeMock.accounts.create).toHaveBeenCalledTimes(1);
    const links = profileLinks();
    expect(links.length, "inventory floor: the real caller's account was linked").toBeGreaterThan(0);
    expect((links[0].payload as Record<string, unknown>).stripe_account_id).toBe(NEW_ACCT);
  });
});
