/**
 * Stripe TEST mode for TEST ACCOUNTS (owner decision 2026-10-12, pop-up "Test
 * mode for test accounts"). Stripe is LIVE on prod; only accounts enrolled in
 * public.test_accounts (and is_seed) pay on the Stripe TEST key, with test
 * cards. The rules live in supabase/functions/_shared/stripeMode.ts; these
 * tests drive the REAL functions through the edge harness and read which key
 * every Stripe client was built with (`stripeMock.__keys`).
 *
 * The three guards the owner's decision needs, each shown red on the code
 * before this change (every function read STRIPE_SECRET_KEY, so a test
 * account always got the live key and a mixed job moved money):
 *   1. a real user can never reach test mode;
 *   2. a test account can never reach live mode;
 *   3. a job that mixes test and real accounts refuses.
 *
 * @mutate supabase/functions/_shared/stripeMode.ts | if (mode === "live") return readEnv(LIVE_KEY_ENV) ?? ""; | if (mode === "live") return readEnv(TEST_KEY_ENV) ?? readEnv(LIVE_KEY_ENV) ?? "";
 * @mutate supabase/functions/_shared/stripeMode.ts | if (tests === parties.length) return { ok: true, mode: "test" }; | if (tests === parties.length) return { ok: true, mode: "live" };
 * @mutate supabase/functions/_shared/stripeMode.ts |   const mode: StripeMode = stored === "test" && !job.partyIds.some((id) => tests.has(id)) ? "live" : stored; |   const mode: StripeMode = stored;
 * @mutate supabase/functions/_shared/stripeMode.ts |   const mustMatch = uniqIds([...(opts.kind === "payout" ? job.payeeIds : []), ...extra, ...testActor]); |   const mustMatch = uniqIds([...extra, ...testActor]);
 * @mutate supabase/functions/_shared/stripeMode.ts |   const stored = opts.kind === "new" ? null : sessionIdMode(job.storedSessionId); |   const stored = null as StripeMode \| null;
 * @mutate supabase/functions/stripe-webhook/index.ts |       if (!TEST_MODE_EVENT_TYPES.has(event.type)) { |       if (false) {
 * @mutate supabase/functions/_shared/stripeMode.ts |   return { ok: false, reason: "mixed_parties" };\n} |   return { ok: true, mode: "live" };\n}
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (!isTestModeKey(key)) throw new StripeModeRefused("test_key_not_test", `${TEST_KEY_ENV} is not a test-mode key; refusing`); |
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (!key) throw new StripeModeRefused("test_key_missing", `${TEST_KEY_ENV} is not set; a test account's payment cannot run`); |   if (!key) return readEnv(LIVE_KEY_ENV) ?? "";
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (enrolledRes?.error \|\| !Array.isArray(enrolledRes?.data)) { |   if (false) {
 * @mutate supabase/functions/create-payment/index.ts |     const stripe = new Stripe(stripeSecretKeyFor(stripeMode), { |     const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") \|\| "", {
 * @mutate supabase/functions/create-payment/index.ts |   const callerCounts = (!isAdmin && callerIsParty) \|\| (isAdmin && tests.has(callerId)); |   const callerCounts = !isAdmin && callerIsParty;
 * @mutate supabase/functions/create-payment/index.ts |   const jobCounts = isAdmin \|\| job.partyIds.includes(callerId); |   const jobCounts = true;
 * @mutate supabase/functions/create-payment/index.ts |   const decidingParties = REFUND_TO_PAYER_ACTIONS.has(String(action)) |   const decidingParties = false
 * @mutate supabase/functions/create-payment/index.ts |   let jobId: string \| null = typeof body?.jobId === "string" && body.jobId.length > 0 ? body.jobId : null; |   let jobId: string \| null = typeof body?.jobId === "string" && /^[0-9a-f]{8}-/i.test(body.jobId) ? body.jobId : null;
 * @mutate supabase/functions/create-payment/index.ts |     if (roleErr) throw new StripeModeRefused("lookup_failed", `admin role read failed: ${roleErr.message}`); |     if (roleErr) void roleErr;
 * @mutate supabase/functions/create-payment/index.ts |     assertSessionMatchesMode(decided.mode, stored?.stripe_session_id ?? null); |     void stored;
 * @mutate supabase/functions/stripe-webhook/index.ts |     const ctx: WebhookContext = { stripe: handlerStripe, supabase, logStep }; |     const ctx: WebhookContext = { stripe, supabase, logStep };
 * @mutate supabase/functions/stripe-webhook/index.ts |       if (!scope.ok) { |       if (false) {
 * @mutate supabase/functions/stripe-webhook/index.ts |     if (event.livemode !== false) { |     if (false) {
 * @mutate supabase/functions/release-payout/index.ts |     stripeMode = await stripeModeForJobActor(supabaseAdmin, job.id, initiatedByUserId, job.stripe_session_id ?? null); |     stripeMode = "live";
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import {
  decideStripeMode,
  sessionIdMode,
  isTestModeKey,
} from "../../../supabase/functions/_shared/stripeMode";

const LIVE_KEY = "sk_live_real_money";
const TEST_KEY = "sk_test_sandbox";
const AUTH = { Authorization: "Bearer test-jwt" };

const TEST_POSTER = "11111111-1111-4111-8111-111111111111";
const TEST_HELPR = "22222222-2222-4222-8222-222222222222";
const REAL_POSTER = "33333333-3333-4333-8333-333333333333";
const REAL_HELPR = "44444444-4444-4444-8444-444444444444";
const REAL_ADMIN = "55555555-5555-4555-8555-555555555555";
const TEST_ADMIN = "66666666-6666-4666-8666-666666666666";
const JOB = "77777777-7777-4777-8777-777777777777";

/** Enrol these ids as TEST ACCOUNTS: a test_accounts row AND profiles.is_seed. */
function enrol(...ids: string[]) {
  scenario.reads.test_accounts = { rows: ids.map((user_id) => ({ user_id })) };
  scenario.reads.profiles = {
    ...(scenario.reads.profiles ?? {}),
    selectOverrides: [
      { includes: "user_id, is_seed", result: { rows: ids.map((user_id) => ({ user_id, is_seed: true })) } },
      ...(scenario.reads.profiles?.selectOverrides ?? []),
    ],
  };
}

function env(extra: Record<string, string | undefined> = {}) {
  const base: Record<string, string> = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_TEST_SECRET_KEY: TEST_KEY,
    STRIPE_WEBHOOK_SECRET: "whsec_live",
    STRIPE_TEST_WEBHOOK_SECRET: "whsec_sandbox",
  };
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  setEnv(base);
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** An unfunded job the poster is paying for. */
function unpaidJob(customerId: string, helperId: string | null = null, session: string | null = null) {
  scenario.reads.jobs = {
    rows: [{
      id: JOB,
      customer_id: customerId,
      helper_id: helperId,
      budget: 100,
      category: "cleaning",
      title: "Clean my house",
      status: "open",
      payment_status: "unpaid",
      stripe_session_id: session,
    }],
  };
  scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = {
    rows: [{ onboarding_fee_paid: true, subscription_tier: "pro" }],
    selectOverrides: scenario.reads.profiles?.selectOverrides,
  };
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" });
}

async function createPayment(body: Record<string, unknown>) {
  const fn = await loadEdgeFunction("create-payment");
  return fn.fetch(fn.request({ headers: AUTH, body }));
}

describe("Stripe mode for test accounts (owner 2026-10-12)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => resetEnv());

  describe("the decision (pure)", () => {
    it("every party test -> test, none -> live, any mix -> refused, nobody -> live", () => {
      expect(decideStripeMode([])).toEqual({ ok: true, mode: "live" });
      expect(decideStripeMode([{ id: "a", test: false }, { id: "b", test: false }])).toEqual({ ok: true, mode: "live" });
      expect(decideStripeMode([{ id: "a", test: true }, { id: "b", test: true }])).toEqual({ ok: true, mode: "test" });
      expect(decideStripeMode([{ id: "a", test: true }, { id: "b", test: false }])).toEqual({ ok: false, reason: "mixed_parties" });
    });
    it("reads a session's mode from its prefix and a key's mode from its prefix", () => {
      expect(sessionIdMode("cs_test_a1")).toBe("test");
      expect(sessionIdMode("cs_live_a1")).toBe("live");
      expect(sessionIdMode("cs_other")).toBeNull();
      expect(isTestModeKey("sk_test_x")).toBe(true);
      expect(isTestModeKey("rk_test_x")).toBe(true);
      expect(isTestModeKey("sk_live_x")).toBe(false);
    });
  });

  describe("1. a real user can never reach test mode", () => {
    it("a real poster's checkout runs on the LIVE key, whatever the body asks for", async () => {
      env();
      scenario.authUser = { id: REAL_POSTER, email: "real@example.com" };
      enrol(TEST_POSTER); // someone else is a test account; this caller is not
      unpaidJob(REAL_POSTER);
      const res = await createPayment({ action: "escrow", jobId: JOB, testMode: true, livemode: false, stripeMode: "test" });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it("a real admin's payout of a real job runs on the LIVE key", async () => {
      env();
      scenario.authUser = { id: REAL_ADMIN, email: "admin@example.com" };
      scenario.rpc.has_role = true;
      scenario.reads.user_roles = { rows: [{ user_id: scenario.authUser!.id }] };
      enrol(TEST_ADMIN);
      unpaidJob(REAL_POSTER, REAL_HELPR);
      await createPayment({ action: "admin_refund_general", jobId: JOB, reason: "x", amountCents: 100 });
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });
  });

  describe("2. a test account can never reach live mode", () => {
    it("a test account's checkout runs on the TEST key and never builds a live client", async () => {
      env();
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER);
      unpaidJob(TEST_POSTER);
      const res = await createPayment({ action: "escrow", jobId: JOB });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it("with no test key set, a test account is refused and nothing reaches Stripe", async () => {
      env({ STRIPE_TEST_SECRET_KEY: undefined });
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER);
      unpaidJob(TEST_POSTER);
      const res = await createPayment({ action: "escrow", jobId: JOB });
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ code: "stripe_mode_refused", reason: "test_key_missing" });
      expect(stripeMock.__keys).toEqual([]);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("a 'test' key that is really a live key is refused", async () => {
      env({ STRIPE_TEST_SECRET_KEY: "sk_live_pasted_in_the_wrong_box" });
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER);
      unpaidJob(TEST_POSTER);
      const res = await createPayment({ action: "escrow", jobId: JOB });
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ reason: "test_key_not_test" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("an unreadable test-account list refuses (fail closed) rather than guessing live", async () => {
      env();
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      unpaidJob(TEST_POSTER);
      scenario.reads.test_accounts = { error: { message: "connection reset" } };
      const res = await createPayment({ action: "escrow", jobId: JOB });
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ reason: "lookup_failed" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("a test admin cannot move a real job's money (the admin counts as a party)", async () => {
      env();
      scenario.authUser = { id: TEST_ADMIN, email: "seed-admin@example.com" };
      scenario.rpc.has_role = true;
      scenario.reads.user_roles = { rows: [{ user_id: scenario.authUser!.id }] };
      enrol(TEST_ADMIN);
      unpaidJob(REAL_POSTER, REAL_HELPR);
      const res = await createPayment({ action: "admin_refund_general", jobId: JOB, reason: "x", amountCents: 100 });
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("a real admin settles a TEST job on the test key (the job decides, not the admin)", async () => {
      env();
      scenario.authUser = { id: REAL_ADMIN, email: "owner@example.com" };
      scenario.rpc.has_role = true;
      scenario.reads.user_roles = { rows: [{ user_id: scenario.authUser!.id }] };
      enrol(TEST_POSTER, TEST_HELPR);
      unpaidJob(TEST_POSTER, TEST_HELPR, "cs_test_paid");
      await createPayment({ action: "admin_refund_general", jobId: JOB, reason: "x", amountCents: 100 });
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
    });

    it("a payout of LIVE money to a test Helpr is refused, on either key", async () => {
      env();
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER, TEST_HELPR);
      unpaidJob(TEST_POSTER, TEST_HELPR, "cs_live_old");
      const res = await createPayment({ action: "release", jobId: JOB });
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("re-minting a test job's checkout skips the live session it cannot read", async () => {
      env();
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER);
      unpaidJob(TEST_POSTER, null, "cs_live_unpaid_from_before");
      const res = await createPayment({ action: "escrow", jobId: JOB });
      expect(res.status).toBe(200);
      expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
    });
  });

  describe("money already taken runs where it sits (reviews 2026-10-12, finding 1)", () => {
    it("a real poster can refund their LIVE escrow even though a test Helpr was hired on it", async () => {
      env();
      scenario.authUser = { id: REAL_POSTER, email: "real@example.com" };
      enrol(TEST_HELPR);
      unpaidJob(REAL_POSTER, TEST_HELPR, "cs_live_paid");
      const res = await createPayment({ action: "cancel_escrow", jobId: JOB });
      expect((await json(res)).code).toBeUndefined();
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("a real admin can refund that LIVE escrow to the poster", async () => {
      env();
      scenario.authUser = { id: REAL_ADMIN, email: "owner@example.com" };
      scenario.rpc.has_role = true;
      scenario.reads.user_roles = { rows: [{ user_id: scenario.authUser!.id }] };
      enrol(TEST_HELPR);
      unpaidJob(REAL_POSTER, TEST_HELPR, "cs_live_paid");
      const res = await createPayment({ action: "admin_refund_general", jobId: JOB, reason: "x", amountCents: 100 });
      expect((await json(res)).code).toBeUndefined();
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("sandbox money on a job with no test account on it stays on the LIVE key (a real person never reaches test mode)", async () => {
      env();
      scenario.authUser = { id: REAL_POSTER, email: "real@example.com" };
      enrol(TEST_POSTER);
      unpaidJob(REAL_POSTER, REAL_HELPR, "cs_test_from_before_go_live");
      await createPayment({ action: "cancel_escrow", jobId: JOB });
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("but paying that LIVE escrow out to the test Helpr is refused", async () => {
      env();
      scenario.authUser = { id: REAL_POSTER, email: "real@example.com" };
      enrol(TEST_HELPR);
      unpaidJob(REAL_POSTER, TEST_HELPR, "cs_live_paid");
      const res = await createPayment({ action: "release", jobId: JOB });
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("the job id is read as the action reads it: an unhyphenated id does not skip the decision", async () => {
      env();
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER);
      unpaidJob(TEST_POSTER, REAL_HELPR, "cs_test_paid");
      const res = await createPayment({ action: "release", jobId: JOB.replace(/-/g, "") });
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("an unreadable admin role on an admin action refuses (fail closed), never guesses a mode", async () => {
      env();
      scenario.authUser = { id: REAL_ADMIN, email: "owner@example.com" };
      scenario.reads.user_roles = { error: { message: "timeout" } };
      enrol(TEST_POSTER, TEST_HELPR);
      unpaidJob(TEST_POSTER, TEST_HELPR, "cs_test_paid");
      const res = await createPayment({ action: "admin_refund_general", jobId: JOB, reason: "x", amountCents: 100 });
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ reason: "lookup_failed" });
      expect(stripeMock.__keys).toEqual([]);
    });
  });

  describe("no oracle: a stranger naming someone else's job learns nothing about who is on it", () => {
    it("a real caller naming a TEST job's id is answered in their own (live) mode and refused as not theirs", async () => {
      env();
      scenario.authUser = { id: REAL_POSTER, email: "real@example.com" };
      enrol(TEST_POSTER, TEST_HELPR);
      unpaidJob(TEST_POSTER, TEST_HELPR, "cs_test_paid");
      const res = await createPayment({ action: "cancel_escrow", jobId: JOB });
      const body = await json(res);
      expect(body.code).toBeUndefined();
      expect(String(body.error)).not.toMatch(/test account/i);
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("a non-admin calling an admin action on a test job is answered in their own mode", async () => {
      env();
      scenario.authUser = { id: REAL_POSTER, email: "real@example.com" };
      scenario.rpc.has_role = false;
      enrol(TEST_POSTER, TEST_HELPR);
      unpaidJob(TEST_POSTER, REAL_HELPR, "cs_test_paid");
      const res = await createPayment({ action: "admin_refund_general", jobId: JOB, reason: "x", amountCents: 100 });
      expect((await json(res)).code).toBeUndefined();
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });
  });

  describe("3. a job that mixes test and real accounts refuses", () => {
    it("create-payment: a test poster's release to a real Helpr moves nothing", async () => {
      env();
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER);
      unpaidJob(TEST_POSTER, REAL_HELPR, "cs_test_paid");
      const res = await createPayment({ action: "release", jobId: JOB });
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ code: "stripe_mode_refused", reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("create-payment: a crew job with one real member refuses", async () => {
      env();
      scenario.authUser = { id: TEST_POSTER, email: "poster-e2e@example.com" };
      enrol(TEST_POSTER, TEST_HELPR);
      unpaidJob(TEST_POSTER, TEST_HELPR, "cs_test_paid");
      scenario.reads.group_job_helpers = { rows: [{ helper_id: TEST_HELPR }, { helper_id: REAL_HELPR }] };
      const res = await createPayment({ action: "release", jobId: JOB });
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
    });

  });

  describe("release-payout (admin and cron): the job's parties decide", () => {
    /** A payable job (completed, payout_pending, captured escrow, Helpr with a Connect account). */
    function payableJob(customerId: string, helperId: string, session: string) {
      scenario.reads.jobs = {
        rows: [{
          id: JOB, title: "Mow the lawn", status: "completed", payment_status: "payout_pending", customer_id: customerId,
          helper_id: helperId, budget: 100, urgent_fee: 0, dispute_status: null, disputed_at: null, is_group_job: false,
          helpers_needed: null, stripe_payment_intent_id: "pi_1", stripe_session_id: session, helper_fee_percent: 10, is_seed: true,
        }],
      };
      scenario.reads.gift_cards = { rows: [] };
      scenario.rpc.restore_gift_card_for_job = { outcome: "would_restore", applied_cents: 11200 };
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", full_name: "Helpful Helper", onboarding_fee_paid: true }] };
      scenario.reads.platform_settings = { rows: [{ helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
      scenario.reads.payout_transfers = { rows: [] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount: 11200, amount_received: 11200 });
      stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true });
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_1", transfer_group: `job_${JOB}` });
    }
    const cron = async () => {
      const fn = await loadEdgeFunction("release-payout");
      return fn.fetch(fn.request({ headers: { Authorization: "Bearer cron-secret" }, body: { job_id: JOB } }));
    };

    it("a test job pays its test Helpr on the TEST key", async () => {
      env({ CRON_SECRET: "cron-secret" });
      payableJob(TEST_POSTER, TEST_HELPR, "cs_test_1");
      enrol(TEST_POSTER, TEST_HELPR);
      await cron();
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    });

    it("a real job pays on the LIVE key", async () => {
      env({ CRON_SECRET: "cron-secret" });
      payableJob(REAL_POSTER, REAL_HELPR, "cs_live_1");
      enrol(TEST_POSTER);
      await cron();
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    });

    it("a job pairing a test poster with a real Helpr pays nothing on either key", async () => {
      env({ CRON_SECRET: "cron-secret" });
      payableJob(TEST_POSTER, REAL_HELPR, "cs_test_1");
      enrol(TEST_POSTER);
      const res = await cron();
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ code: "stripe_mode_refused", reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("a TEST admin cannot pay out a real job", async () => {
      env({ CRON_SECRET: "cron-secret" });
      scenario.authUser = { id: TEST_ADMIN, email: "seed-admin@example.com" };
      scenario.rpc.has_role = true;
      payableJob(REAL_POSTER, REAL_HELPR, "cs_live_1");
      enrol(TEST_ADMIN);
      const fn = await loadEdgeFunction("release-payout");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { job_id: JOB } }));
      expect(res.status).toBe(409);
      expect(await json(res)).toMatchObject({ reason: "mixed_parties" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("a REAL admin pays out a test job on the TEST key", async () => {
      env({ CRON_SECRET: "cron-secret" });
      scenario.authUser = { id: REAL_ADMIN, email: "owner@example.com" };
      scenario.rpc.has_role = true;
      payableJob(TEST_POSTER, TEST_HELPR, "cs_test_1");
      enrol(TEST_POSTER, TEST_HELPR);
      const fn = await loadEdgeFunction("release-payout");
      await fn.fetch(fn.request({ headers: AUTH, body: { job_id: JOB } }));
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
    });
  });

  describe("stripe-webhook routes by the endpoint that signed it", () => {
    const deliver = async (event: Record<string, unknown>, signedBy: "live" | "test") => {
      stripeMock.webhooks.constructEventAsync.mockImplementation(async (_b: string, _s: string, secret: string) => {
        if ((signedBy === "live" && secret === "whsec_live") || (signedBy === "test" && secret === "whsec_sandbox")) return event;
        throw new Error("No signatures found matching the expected signature for payload");
      });
      const fn = await loadEdgeFunction("stripe-webhook");
      return fn.fetch(fn.request({ rawBody: JSON.stringify(event), headers: { "stripe-signature": "t=1,v1=x", "content-type": "application/json" } }));
    };
    const event = (livemode: boolean, metadata: Record<string, string>, type = "charge.refund.updated") => ({
      id: `evt_${livemode ? "live" : "test"}_1`,
      type,
      livemode,
      data: { object: { id: "obj_1", metadata } },
    });

    it("a TEST-endpoint event about a test job is processed with the TEST key", async () => {
      env();
      enrol(TEST_POSTER, TEST_HELPR);
      scenario.reads.jobs = { rows: [{ id: JOB, customer_id: TEST_POSTER, helper_id: TEST_HELPR }] };
      const res = await deliver(event(false, { job_id: JOB }), "test");
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ received: true });
      // The live client verifies signatures; the handlers get the test client.
      expect(stripeMock.__keys).toEqual([LIVE_KEY, TEST_KEY]);
      expect(scenario.writes.some((w) => w.table === "stripe_webhook_events" && w.op === "insert")).toBe(true);
    });

    it("a TEST-endpoint event naming a REAL person's job is acknowledged and NOT applied", async () => {
      env();
      enrol(TEST_POSTER);
      scenario.reads.jobs = { rows: [{ id: JOB, customer_id: REAL_POSTER, helper_id: null }] };
      const res = await deliver(event(false, { job_id: JOB }), "test");
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ ignored: "test_event_names_real_account" });
      expect(scenario.writes.some((w) => w.table === "stripe_webhook_events")).toBe(false);
    });

    it("a TEST-endpoint Pro subscription event is acknowledged and NOT applied (Pro stays live-only)", async () => {
      env();
      enrol(TEST_POSTER);
      const res = await deliver(event(false, {}, "customer.subscription.updated"), "test");
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ ignored: "test_event_type_not_routed" });
      expect(scenario.writes.some((w) => w.table === "stripe_webhook_events")).toBe(false);
    });

    it("a TEST-endpoint Connect update for an account a REAL profile holds is NOT applied", async () => {
      env();
      enrol(TEST_HELPR);
      scenario.reads.profiles = {
        ...(scenario.reads.profiles ?? {}),
        selectOverrides: [
          ...(scenario.reads.profiles?.selectOverrides ?? []),
          { includes: "user_id", result: { rows: [{ user_id: REAL_HELPR }] } },
        ],
      };
      const ev = { id: "evt_acct", type: "account.updated", livemode: false, data: { object: { object: "account", id: "acct_sandbox_left_on_real", metadata: {} } } };
      const res = await deliver(ev, "test");
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ ignored: "test_event_names_real_account" });
      expect(scenario.writes.some((w) => w.table === "stripe_webhook_events")).toBe(false);
    });

    it("an event signed by the TEST secret that claims livemode=true is refused", async () => {
      env();
      enrol(TEST_POSTER);
      scenario.reads.jobs = { rows: [{ id: JOB, customer_id: TEST_POSTER, helper_id: null }] };
      const res = await deliver(event(true, { job_id: JOB }), "test");
      expect(res.status).toBe(400);
      expect(scenario.writes.some((w) => w.table === "stripe_webhook_events")).toBe(false);
    });

    it("a LIVE-endpoint event keeps the live key and never builds a test client", async () => {
      env();
      enrol(TEST_POSTER);
      scenario.reads.jobs = { rows: [{ id: JOB, customer_id: REAL_POSTER, helper_id: REAL_HELPR }] };
      const res = await deliver(event(true, { job_id: JOB }), "live");
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("a TEST-endpoint event with no test key set is refused 500 (Stripe retries once it is set)", async () => {
      env({ STRIPE_TEST_SECRET_KEY: undefined });
      enrol(TEST_POSTER);
      scenario.reads.jobs = { rows: [{ id: JOB, customer_id: TEST_POSTER, helper_id: null }] };
      const res = await deliver(event(false, { job_id: JOB }), "test");
      expect(res.status).toBe(500);
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
      expect(scenario.writes.some((w) => w.table === "stripe_webhook_events")).toBe(false);
    });
  });

  describe("caller-only functions (the Helpr's own Connect account)", () => {
    it("stripe-payouts: a test Helpr reads their account with the TEST key, a real one with the LIVE key", async () => {
      for (const [who, test, expected] of [[TEST_HELPR, true, TEST_KEY], [REAL_HELPR, false, LIVE_KEY]] as const) {
        resetStripeMock();
        resetSupabaseMock();
        env();
        scenario.authUser = { id: who, email: "h@example.com" };
        scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helpr" }] };
        if (test) enrol(who);
        const fn = await loadEdgeFunction("stripe-payouts");
        await fn.fetch(fn.request({ headers: AUTH, body: {} }));
        expect(stripeMock.__keys).toEqual([expected]);
      }
    });
  });
});
