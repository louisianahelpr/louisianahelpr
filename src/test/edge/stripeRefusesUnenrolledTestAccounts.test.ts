/**
 * A test-looking account that is not a properly enrolled test account never
 * runs LIVE (Oct 2026 money audit, finding 7; owner via lead 2026-10-25).
 *
 * The incident: the shared e2e accounts (helpr-e2e-poster-0902 /
 * helpr-e2e-helper-0902 @mailinator.com) were re-created on 2026-10-09 and
 * re-enrolled in public.test_accounts only on 10-12 03:00Z. stripeMode.ts read
 * "TEST = enrolled AND is_seed, anything else LIVE", so in that gap every
 * checkout they opened ran on the LIVE key. Now (supabase/functions/_shared/
 * stripeMode.ts classifyParties + refuseUnenrolled):
 *   - is_seed without enrolment, or enrolment without is_seed -> REFUSED
 *     ("unenrolled_seed", 403);
 *   - a fixture inbox email (is_fixture_email) without enrolment -> REFUSED
 *     ("fixture_email", 403) with a sentence telling the person to use a
 *     regular email (owner Q2: never a bare error);
 *   - a failed read -> REFUSED ("lookup_failed", 503);
 *   - new money and payouts refuse; a refund or a read of money already taken
 *     still runs where the money sits (owner Q4);
 *   - the live-only functions (Pro checkout, Stripe Identity) refuse any test
 *     account as well (refuseLiveOnlyForTestOrSeed).
 * These drive the REAL functions through the edge harness and read which key
 * every Stripe client was built with (`stripeMock.__keys`).
 *
 * @mutate supabase/functions/_shared/stripeMode.ts |     else if (isEnrolled \|\| isSeed) out.set(id, "unenrolled_seed"); |     else if (isEnrolled \|\| isSeed) out.set(id, "real");
 * @mutate supabase/functions/_shared/stripeMode.ts |     else if (fixture.has(id)) out.set(id, "fixture_email"); |     else if (fixture.has(id)) out.set(id, "real");
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (strictKind(opts.kind)) refuseUnenrolled(classes, opts.mustBeEnrolled ?? parties, "parties", opts.caller); |   void strictKind;
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (opts.kind === "new") refuseUnenrolled(classes, [...job.partyIds, ...extra, actor], `job ${jobId ?? "none"} (new)`, actor); |   if (false) void 0;
 * @mutate supabase/functions/_shared/stripeMode.ts |   else if (opts.kind === "payout") refuseUnenrolled(classes, [...job.payeeIds, ...extra, actor], `job ${jobId ?? "none"} (payout)`, actor); |
 * @mutate supabase/functions/_shared/stripeMode.ts |     if (strictKind(kind)) refuseUnenrolled(known, mustBeEnrolled ?? parties, "parties", null); |     void kind;
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (profRes?.error \|\| !Array.isArray(profRes?.data)) { |   if (false) {
 * @mutate supabase/functions/_shared/stripeMode.ts | const strictKind = (kind: MoneyKind \| undefined): boolean => kind === undefined \|\| kind === "new" \|\| kind === "payout"; | const strictKind = (kind: MoneyKind \| undefined): boolean => kind === undefined \|\| kind === "new" \|\| kind === "payout" \|\| kind === "refund";
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import {
  classifyParties,
  createStripeModeResolver,
  isFixtureEmail,
  jobMoneyMode,
  StripeModeRefused,
  stripeModeForParties,
} from "../../../supabase/functions/_shared/stripeMode";

const LIVE_KEY = "sk_live_real_money";
const TEST_KEY = "sk_test_sandbox";
const AUTH = { Authorization: "Bearer test-jwt" };

const SEED_ONLY = "11111111-1111-4111-8111-111111111111"; // is_seed, not enrolled (the 10-09..10-12 gap)
const ENROLLED_ONLY = "22222222-2222-4222-8222-222222222222"; // enrolled, is_seed false
const FIXTURE = "33333333-3333-4333-8333-333333333333"; // @mailinator.com, neither flag
const REAL = "44444444-4444-4444-8444-444444444444";
const REAL_HELPR = "55555555-5555-4555-8555-555555555555";
const TESTER = "66666666-6666-4666-8666-666666666666"; // enrolled AND is_seed
const JOB = "77777777-7777-4777-8777-777777777777";

type Person = { user_id: string; is_seed: boolean; email: string; enrolled: boolean };
const PEOPLE: Record<string, Person> = {
  [SEED_ONLY]: { user_id: SEED_ONLY, is_seed: true, email: "helpr-e2e-poster-0902@mailinator.com", enrolled: false },
  [ENROLLED_ONLY]: { user_id: ENROLLED_ONLY, is_seed: false, email: "someone@example.com", enrolled: true },
  [FIXTURE]: { user_id: FIXTURE, is_seed: false, email: "Stranger@Mailinator.com ", enrolled: false },
  [REAL]: { user_id: REAL, is_seed: false, email: "real.person@example.com", enrolled: false },
  [REAL_HELPR]: { user_id: REAL_HELPR, is_seed: false, email: "helpr@example.com", enrolled: false },
  [TESTER]: { user_id: TESTER, is_seed: true, email: "helpr-e2e-helper-0902@mailinator.com", enrolled: true },
};

/** What the mode decision reads: test_accounts rows and every party's profile (is_seed, email). */
function people() {
  const all = Object.values(PEOPLE);
  scenario.reads.test_accounts = { rows: all.filter((p) => p.enrolled).map((p) => ({ user_id: p.user_id })) };
  scenario.reads.profiles = {
    ...(scenario.reads.profiles ?? {}),
    selectOverrides: [
      { includes: "user_id, is_seed, email", result: { rows: all.map(({ user_id, is_seed, email }) => ({ user_id, is_seed, email })) } },
      ...(scenario.reads.profiles?.selectOverrides ?? []),
    ],
  };
}

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: LIVE_KEY,
    STRIPE_TEST_SECRET_KEY: TEST_KEY,
  });
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** A job the poster is paying for (or has paid, with `session`). */
function job(customerId: string, helperId: string | null = null, session: string | null = null) {
  scenario.reads.jobs = {
    rows: [{
      id: JOB, customer_id: customerId, helper_id: helperId, budget: 100, category: "cleaning",
      title: "Clean my house", status: "open", payment_status: "unpaid", stripe_session_id: session,
    }],
  };
  scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 10, onboarding_fee_cents: 200 }] };
  scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true, subscription_tier: "pro" }], selectOverrides: scenario.reads.profiles?.selectOverrides };
  stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_new", url: "https://checkout.stripe.test/cs_new" });
}

async function createPayment(caller: string, body: Record<string, unknown>) {
  scenario.authUser = { id: caller, email: PEOPLE[caller].email.trim() };
  const fn = await loadEdgeFunction("create-payment");
  return fn.fetch(fn.request({ headers: AUTH, body }));
}

/** A tiny service-role double for the pure decision functions. */
function db(opts: { profilesError?: boolean; job?: { customer_id: string | null; helper_id: string | null; stripe_session_id: string | null } } = {}) {
  return {
    from(table: string) {
      const rows = table === "test_accounts"
        ? Object.values(PEOPLE).filter((p) => p.enrolled).map((p) => ({ user_id: p.user_id }))
        : table === "profiles"
        ? Object.values(PEOPLE).map(({ user_id, is_seed, email }) => ({ user_id, is_seed, email }))
        : [];
      const result = table === "profiles" && opts.profilesError ? { data: null, error: { message: "connection reset" } } : { data: rows, error: null };
      const q = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: async () => ({ data: opts.job ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => resolve(result),
      };
      return q;
    },
  };
}

describe("a test-looking account that is not enrolled never runs live (audit finding 7)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => resetEnv());

  describe("the classification", () => {
    it("tells test, real and the two test-looking kinds apart, from test_accounts, is_seed and the email", async () => {
      const c = await classifyParties(db(), Object.keys(PEOPLE));
      expect(Object.fromEntries(c)).toEqual({
        [SEED_ONLY]: "unenrolled_seed",
        [ENROLLED_ONLY]: "unenrolled_seed",
        [FIXTURE]: "fixture_email",
        [REAL]: "real",
        [REAL_HELPR]: "real",
        [TESTER]: "test",
      });
    });

    it("the fixture-inbox rule is is_fixture_email's (case and spaces ignored)", () => {
      expect(isFixtureEmail(" A@MAILINATOR.com")).toBe(true);
      expect(isFixtureEmail("cast@helpr.test")).toBe(true);
      expect(isFixtureEmail("eli.test.helper@louisianahelpr.com")).toBe(true);
      expect(isFixtureEmail("mailinator.com@example.com")).toBe(false);
      expect(isFixtureEmail("eli@helpr.testing.com")).toBe(false);
      expect(isFixtureEmail(null)).toBe(false);
    });

    it("an unreadable profile list refuses (fail closed)", async () => {
      await expect(stripeModeForParties(db({ profilesError: true }), [REAL])).rejects.toMatchObject({ reason: "lookup_failed" });
    });
  });

  describe("new money: job checkout (create-payment escrow)", () => {
    it("control: a real poster's checkout runs LIVE", async () => {
      env();
      people();
      job(REAL);
      const res = await createPayment(REAL, { action: "escrow", jobId: JOB });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("control: an enrolled test account's checkout runs on the TEST key", async () => {
      env();
      people();
      job(TESTER);
      const res = await createPayment(TESTER, { action: "escrow", jobId: JOB });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
    });

    for (const [who, id, reason] of [
      ["is_seed but not enrolled (the 10-09..10-12 gap)", SEED_ONLY, "unenrolled_seed"],
      ["enrolled but not is_seed", ENROLLED_ONLY, "unenrolled_seed"],
      ["a fixture inbox email, not enrolled", FIXTURE, "fixture_email"],
    ] as const) {
      it(`a poster who is ${who} is refused before any Stripe client`, async () => {
        env();
        people();
        job(id);
        const res = await createPayment(id, { action: "escrow", jobId: JOB });
        expect(res.status).toBe(403);
        expect(await json(res)).toMatchObject({ code: "stripe_mode_refused", reason });
        expect(stripeMock.__keys).toEqual([]);
        expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
      });
    }

    it("a fixture inbox is told, in words, to use a regular email (never a bare error)", async () => {
      env();
      people();
      job(FIXTURE);
      const body = await json(await createPayment(FIXTURE, { action: "escrow", jobId: JOB }));
      expect(String(body.error)).toMatch(/regular email address/);
      expect(String(body.error)).toMatch(/No money was moved/);
    });

    // lh-authz-rls + lh-money-escrow reviews 2026-10-25: the poster is neither
    // blamed ("use a regular email") nor told what kind of account the Helpr has.
    // @mutate supabase/functions/_shared/stripeMode.ts |     : "counterparty_refused"; |     : bad.map((id) => classes.get(id)).includes("fixture_email") ? "fixture_email" : "unenrolled_seed";
    it("a real poster's checkout is refused when the hired Helpr is test-looking, in words about neither account", async () => {
      for (const helpr of [SEED_ONLY, FIXTURE]) {
        resetStripeMock();
        resetSupabaseMock();
        env();
        people();
        job(REAL, helpr);
        const res = await createPayment(REAL, { action: "escrow", jobId: JOB });
        expect(res.status, helpr).toBe(409);
        const body = await json(res);
        expect(body.reason, helpr).toBe("counterparty_refused");
        expect(String(body.error), helpr).not.toMatch(/email|test/i);
        expect(stripeMock.__keys, helpr).toEqual([]);
      }
    });

    it("an unreadable test_accounts list refuses (fail closed) rather than guessing live", async () => {
      env();
      people();
      job(REAL);
      scenario.reads.test_accounts = { error: { message: "connection reset" } };
      const res = await createPayment(REAL, { action: "escrow", jobId: JOB });
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ reason: "lookup_failed" });
      expect(stripeMock.__keys).toEqual([]);
    });
  });

  describe("money already taken (owner Q4)", () => {
    it("a refund of LIVE money to an unenrolled seed poster still runs LIVE (money goes back where it came from)", async () => {
      await expect(jobMoneyMode(db({ job: { customer_id: SEED_ONLY, helper_id: REAL_HELPR, stripe_session_id: "cs_live_paid" } }), JOB, { kind: "refund" }))
        .resolves.toBe("live");
      await expect(jobMoneyMode(db({ job: { customer_id: SEED_ONLY, helper_id: null, stripe_session_id: null } }), JOB, { kind: "refund" }))
        .resolves.toBe("live");
      await expect(jobMoneyMode(db({ job: { customer_id: FIXTURE, helper_id: null, stripe_session_id: "cs_live_paid" } }), JOB, { kind: "read" }))
        .resolves.toBe("live");
    });

    it("a payout of LIVE money to an unenrolled seed Helpr is refused", async () => {
      // (No actor: a cron. Nobody reads the sentence, so it names no account kind.)
      await expect(jobMoneyMode(db({ job: { customer_id: REAL, helper_id: SEED_ONLY, stripe_session_id: "cs_live_paid" } }), JOB, { kind: "payout" }))
        .rejects.toMatchObject({ reason: "counterparty_refused" });
      // ...but a real Helpr is paid out of an unenrolled seed poster's live escrow (it pays nobody test-looking).
      await expect(jobMoneyMode(db({ job: { customer_id: SEED_ONLY, helper_id: REAL_HELPR, stripe_session_id: "cs_live_paid" } }), JOB, { kind: "payout" }))
        .resolves.toBe("live");
    });

    it("an unenrolled seed ACTOR cannot take new money or pay out on a real job", async () => {
      const j = { job: { customer_id: REAL, helper_id: REAL_HELPR, stripe_session_id: null } };
      await expect(jobMoneyMode(db(j), JOB, { kind: "new", actorId: FIXTURE })).rejects.toMatchObject({ reason: "fixture_email" });
      await expect(jobMoneyMode(db({ job: { ...j.job, stripe_session_id: "cs_live_paid" } }), JOB, { kind: "payout", actorId: SEED_ONLY }))
        .rejects.toBeInstanceOf(StripeModeRefused);
      await expect(jobMoneyMode(db(j), JOB, { kind: "new", actorId: REAL })).resolves.toBe("live");
    });
  });

  describe("crons (the per-run resolver: tips, recurring visits, payouts, refunds)", () => {
    it("new money and payouts refuse an unenrolled party; a refund or a read runs live", async () => {
      env();
      const r = createStripeModeResolver(db(), (key) => ({ key }));
      await expect(r.clientForParties([REAL, SEED_ONLY])).rejects.toMatchObject({ reason: "counterparty_refused" });
      await expect(r.clientForParties([FIXTURE], "payout")).rejects.toMatchObject({ reason: "counterparty_refused" });
      await expect(r.modeForParties([SEED_ONLY], "refund")).resolves.toBe("live");
      await expect(r.clientForParties([FIXTURE], "read")).resolves.toMatchObject({ mode: "live", stripe: { key: LIVE_KEY } });
      await expect(r.clientForParties([TESTER])).resolves.toMatchObject({ mode: "test" });
      await expect(r.clientForParties([REAL, REAL_HELPR])).resolves.toMatchObject({ mode: "live" });
      // A payout checks only its payee: a test-looking buyer never blocks a real seller (lh-money-escrow review, finding 2).
      await expect(r.clientForParties([FIXTURE, REAL_HELPR], "payout", [REAL_HELPR])).resolves.toMatchObject({ mode: "live" });
      await expect(r.clientForParties([REAL, SEED_ONLY], "payout", [SEED_ONLY])).rejects.toMatchObject({ reason: "counterparty_refused" });
    });
  });

  describe("caller-only entry points", () => {
    beforeEach(() => env());

    it("create-gift-card-checkout: an unenrolled seed buyer is refused before any Stripe client", async () => {
      people();
      scenario.authUser = { id: SEED_ONLY, email: PEOPLE[SEED_ONLY].email };
      scenario.reads.gift_cards = { rows: [{ id: "gift_1" }] };
      const fn = await loadEdgeFunction("create-gift-card-checkout");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { amount: 25, recipient_email: "real.person@example.com" } }));
      expect(res.status).toBe(403);
      expect(await json(res)).toMatchObject({ reason: "unenrolled_seed" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("stripe-connect (payout setup): a fixture inbox is refused with the regular-email sentence; a real member reaches the LIVE key", async () => {
      for (const [id, refused] of [[FIXTURE, true], [REAL, false]] as const) {
        resetStripeMock();
        resetSupabaseMock();
        env();
        people();
        scenario.authUser = { id, email: PEOPLE[id].email.trim() };
        const fn = await loadEdgeFunction("stripe-connect");
        const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
        if (refused) {
          expect(res.status, id).toBe(403);
          const body = await json(res);
          expect(body.reason, id).toBe("fixture_email");
          expect(String(body.error), id).toMatch(/regular email address/);
          expect(stripeMock.__keys, id).toEqual([]);
        } else {
          expect(stripeMock.__keys, id).toEqual([LIVE_KEY]);
        }
      }
    });

    it("stripe-payouts (read only, owner Q4): a fixture inbox still reads its own live earnings", async () => {
      // A connected payout account, so stripe-payouts gets as far as Stripe.
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_fixture" }] };
      people();
      scenario.authUser = { id: FIXTURE, email: PEOPLE[FIXTURE].email.trim() };
      const fn = await loadEdgeFunction("stripe-payouts");
      await fn.fetch(fn.request({ headers: AUTH, body: {} }));
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("create-pro-checkout (live only): an ENROLLED test account and an unenrolled seed account are both refused; a real member is not", async () => {
      for (const [id, reason] of [[TESTER, "test_account_live_only"], [SEED_ONLY, "unenrolled_seed"], [FIXTURE, "fixture_email"], [REAL, null]] as const) {
        resetStripeMock();
        resetSupabaseMock();
        env();
        people();
        scenario.authUser = { id, email: PEOPLE[id].email.trim(), email_confirmed_at: "2026-10-01T00:00:00Z" } as never;
        scenario.rpc.feature_enabled_for_user = true;
        const fn = await loadEdgeFunction("create-pro-checkout");
        const res = await fn.fetch(fn.request({ headers: AUTH, body: { tier: "pro", billing_cycle: "monthly" } }));
        if (reason) {
          expect(res.status, id).toBe(403);
          expect((await json(res)).reason, id).toBe(reason);
          expect(stripeMock.__keys, id).toEqual([]);
        } else {
          // Control: a real member gets as far as the live Stripe client.
          expect(stripeMock.__keys, id).toEqual([LIVE_KEY]);
        }
      }
    });

    it("stripe-idv-start (live only): a test account never opens a live Identity check; a real member reaches the LIVE key", async () => {
      for (const [id, reason] of [[TESTER, "test_account_live_only"], [REAL, null]] as const) {
        resetStripeMock();
        resetSupabaseMock();
        env();
        people();
        scenario.authUser = { id, email: PEOPLE[id].email.trim(), email_confirmed_at: "2026-10-01T00:00:00Z" } as never;
        scenario.rpc.feature_enabled_for_user = true;
        const fn = await loadEdgeFunction("stripe-idv-start");
        const res = await fn.fetch(fn.request({ headers: AUTH, body: {} }));
        if (reason) {
          expect(res.status, id).toBe(403);
          expect((await json(res)).reason, id).toBe(reason);
          expect(stripeMock.__keys, id).toEqual([]);
        } else {
          expect(stripeMock.__keys, id).toEqual([LIVE_KEY]);
        }
      }
    });
  });
});
