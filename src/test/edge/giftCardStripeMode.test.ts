/**
 * Q1750: gift cards take the Stripe mode of the BUYER (lead decision
 * 2026-10-15). A real buyer pays LIVE whoever receives the gift (real money is
 * real). A TEST account buyer pays on the TEST key and may gift only another
 * test account; any other recipient is refused before Stripe is reached. The
 * webhook applies a TEST-mode gift only when donor and recipient are both test
 * accounts, so sandbox credit can never be claimed by a real person.
 *
 * Red on the code before this change: create-gift-card-checkout built its
 * client from STRIPE_SECRET_KEY for everyone (a test buyer got the live key),
 * and the webhook refused every TEST-mode gift as not routed.
 *
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | if (stripeMode === "test") | if (stripeMode === "nope")
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | if (!bothTest) | if (bothTest && false)
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | const stripe = new Stripe(stripeSecretKeyFor(stripeMode), | const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") \|\| "",
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | recipientUserId = String(eligibleProfile.user_id); | recipientUserId = null;
 * @mutate supabase/functions/_shared/stripeMode.ts | "recurring_visit", "gift_card_purchase"]); | "recurring_visit"]);
 * @mutate supabase/functions/_shared/stripeMode.ts |   if (owners.length !== 1) return false; |   if (owners.length === 0) return true;
 * @mutate supabase/functions/_shared/stripeMode.ts |   return tests.has(donor) && tests.has(owners[0]); |   return tests.has(owners[0]);
 * @mutate supabase/functions/stripe-webhook/index.ts | !(await testGiftIsTestToTest(supabase, eventObject)) | false
 * @mutate supabase/functions/claim-gift-card/index.ts | if (callerMode !== "test") | if (callerMode === "nope")
 * @mutate supabase/functions/claim-gift-card/index.ts | if (sessionIdMode(credit.stripe_session_id as string \| null) === "test") | if (sessionIdMode(credit.stripe_session_id as string \| null) === "nope")
 * @mutate supabase/functions/create-gift-card-checkout/index.ts | ${stripeMode === "test" ? "test:" : ""} |
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const LIVE_KEY = "sk_live_real_money";
const TEST_KEY = "sk_test_sandbox";
const AUTH = { Authorization: "Bearer test-jwt" };

const TEST_BUYER = "11111111-1111-4111-8111-111111111111";
const TEST_RECIPIENT = "22222222-2222-4222-8222-222222222222";
const REAL_BUYER = "33333333-3333-4333-8333-333333333333";
const REAL_RECIPIENT = "44444444-4444-4444-8444-444444444444";
const TEST_RECIPIENT_EMAIL = "helper-e2e@example.com";
const REAL_RECIPIENT_EMAIL = "real.person@example.com";

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

/** The account a typed recipient email belongs to (none when ownerId is null). */
function emailOwner(email: string, ownerId: string | null) {
  scenario.reads.profiles = {
    ...(scenario.reads.profiles ?? {}),
    rows: [{ user_id: ownerId ?? TEST_RECIPIENT }],
    eqOverrides: [{ column: "email", value: email, result: { rows: ownerId ? [{ user_id: ownerId }] : [] } }],
  };
}

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

async function buyGift(buyerId: string, body: Record<string, unknown>) {
  scenario.authUser = { id: buyerId, email: `${buyerId.slice(0, 4)}@buyer.example.com` };
  stripeMock.customers.list.mockResolvedValue({ data: [] });
  stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_gift", url: "https://checkout.stripe.test/cs_gift" });
  scenario.reads.gift_cards = { rows: [{ id: "gift_1" }] };
  const fn = await loadEdgeFunction("create-gift-card-checkout");
  return fn.fetch(fn.request({ headers: AUTH, body: { amount: 25, ...body } }));
}

const giftWrites = () => scenario.writes.filter((w) => w.table === "gift_cards");

describe("Q1750: a gift card runs in the buyer mode, and test credit goes only to test accounts", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => resetEnv());

  describe("create-gift-card-checkout", () => {
    it("a real buyer gifting a real person pays on the LIVE key", async () => {
      env();
      enrol(TEST_RECIPIENT);
      emailOwner(REAL_RECIPIENT_EMAIL, REAL_RECIPIENT);
      const res = await buyGift(REAL_BUYER, { recipient_email: REAL_RECIPIENT_EMAIL });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
    });

    it("a real buyer gifting a TEST account still pays LIVE (real money stays real)", async () => {
      env();
      enrol(TEST_RECIPIENT);
      emailOwner(TEST_RECIPIENT_EMAIL, TEST_RECIPIENT);
      const res = await buyGift(REAL_BUYER, { recipient_email: TEST_RECIPIENT_EMAIL });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([LIVE_KEY]);
      expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
    });

    it("a test buyer gifting a test account by typed email pays on the TEST key", async () => {
      env();
      enrol(TEST_BUYER, TEST_RECIPIENT);
      emailOwner(TEST_RECIPIENT_EMAIL, TEST_RECIPIENT);
      const res = await buyGift(TEST_BUYER, { recipient_email: TEST_RECIPIENT_EMAIL });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
      expect(giftWrites()).toHaveLength(1);
      // The mode is part of the idempotency key (lh-money-escrow review, finding 4).
      expect(stripeMock.checkout.sessions.create.mock.calls[0][1]).toEqual({ idempotencyKey: `gift-card:test:${TEST_BUYER}:${TEST_RECIPIENT_EMAIL}:2500` });
    });

    it("a test buyer gifting a test account picked by name pays on the TEST key", async () => {
      env();
      enrol(TEST_BUYER, TEST_RECIPIENT);
      // The email lookup finds nobody: only the picked id can make this a test-to-test gift.
      scenario.reads.profiles = {
        ...(scenario.reads.profiles ?? {}),
        rows: [{ user_id: TEST_RECIPIENT }],
        eqOverrides: [{ column: "email", value: TEST_RECIPIENT_EMAIL, result: { rows: [] } }],
      };
      scenario.adminUsers = { [TEST_RECIPIENT]: { email: TEST_RECIPIENT_EMAIL, email_confirmed_at: "2026-01-01T00:00:00Z" } };
      const res = await buyGift(TEST_BUYER, { recipient_id: TEST_RECIPIENT });
      expect(res.status).toBe(200);
      expect(stripeMock.__keys).toEqual([TEST_KEY]);
    });

    it("a test buyer gifting a REAL account is refused before Stripe, and no gift row is written", async () => {
      env();
      enrol(TEST_BUYER, TEST_RECIPIENT);
      emailOwner(REAL_RECIPIENT_EMAIL, REAL_RECIPIENT);
      const res = await buyGift(TEST_BUYER, { recipient_email: REAL_RECIPIENT_EMAIL });
      expect(res.status).toBe(409);
      expect(String((await json(res)).error)).toMatch(/only to another test account/);
      expect(stripeMock.__keys).toEqual([]);
      expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
      expect(giftWrites()).toHaveLength(0);
    });

    it("a test buyer gifting an email with NO account is refused (an unknown address is not a test account)", async () => {
      env();
      enrol(TEST_BUYER, TEST_RECIPIENT);
      emailOwner("nobody.yet@example.com", null);
      const res = await buyGift(TEST_BUYER, { recipient_email: "nobody.yet@example.com" });
      expect(res.status).toBe(409);
      expect(stripeMock.__keys).toEqual([]);
      expect(giftWrites()).toHaveLength(0);
    });

    it("a test buyer whose recipient lookup fails is refused (fail closed), nothing reaches Stripe", async () => {
      env();
      enrol(TEST_BUYER, TEST_RECIPIENT);
      scenario.reads.profiles = {
        ...(scenario.reads.profiles ?? {}),
        eqOverrides: [{ column: "email", value: TEST_RECIPIENT_EMAIL, result: { error: { message: "connection reset" } } }],
      };
      const res = await buyGift(TEST_BUYER, { recipient_email: TEST_RECIPIENT_EMAIL });
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ code: "stripe_mode_refused", reason: "lookup_failed" });
      expect(stripeMock.__keys).toEqual([]);
    });

    it("a test buyer with no test key set is refused, and never falls back to the live key", async () => {
      env({ STRIPE_TEST_SECRET_KEY: undefined });
      enrol(TEST_BUYER, TEST_RECIPIENT);
      emailOwner(TEST_RECIPIENT_EMAIL, TEST_RECIPIENT);
      const res = await buyGift(TEST_BUYER, { recipient_email: TEST_RECIPIENT_EMAIL });
      expect(res.status).toBe(503);
      expect(await json(res)).toMatchObject({ reason: "test_key_missing" });
      expect(stripeMock.__keys).toEqual([]);
    });
  });

  describe("claim-gift-card: sandbox credit is claimable only by a test account", () => {
    const claim = async (callerId: string, sessionId: string) => {
      scenario.authUser = { id: callerId, email: TEST_RECIPIENT_EMAIL };
      scenario.reads.gift_cards = {
        rows: [{ id: "gift_1", recipient_id: null, recipient_email: TEST_RECIPIENT_EMAIL, status: "sent", expires_at: null, payment_status: "paid", stripe_session_id: sessionId }],
      };
      const fn = await loadEdgeFunction("claim-gift-card");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { claim_token: "tok" } }));
      return { status: res.status, body: await json(res) };
    };
    const bound = () => scenario.writes.some((w) => w.table === "gift_cards" && w.op === "update");

    it("a REAL account cannot claim an unbound gift paid on the TEST key, even with the right email and token", async () => {
      env();
      enrol(TEST_RECIPIENT);
      const { status } = await claim(REAL_RECIPIENT, "cs_test_gift");
      expect(status).toBe(403);
      expect(bound()).toBe(false);
    });

    it("a test account claims a TEST-key gift; a LIVE gift is claimed as before by anyone it names", async () => {
      env();
      enrol(TEST_RECIPIENT);
      expect((await claim(TEST_RECIPIENT, "cs_test_gift")).status).toBe(200);
      expect(bound()).toBe(true);
      resetSupabaseMock();
      enrol(TEST_RECIPIENT);
      expect((await claim(REAL_RECIPIENT, "cs_live_gift")).status).toBe(200);
      expect(bound()).toBe(true);
    });

    it("a TEST-key gift whose caller lookup fails is refused (fail closed)", async () => {
      env();
      scenario.reads.test_accounts = { error: { message: "connection reset" } };
      const { status, body } = await claim(TEST_RECIPIENT, "cs_test_gift");
      expect(status).toBe(503);
      expect(body).toMatchObject({ reason: "lookup_failed" });
      expect(bound()).toBe(false);
    });
  });

  describe("stripe-webhook: a TEST-mode gift is applied only test-to-test", () => {
    const deliverGift = async (donorId: string, recipientEmail: string) => {
      const ev = {
        id: "evt_gift",
        type: "checkout.session.completed",
        livemode: false,
        data: { object: { id: "cs_test_gift", object: "checkout.session", mode: "payment", metadata: { kind: "gift_card_purchase", donor_id: donorId, recipient_email: recipientEmail, amount_cents: "2500" } } },
      };
      stripeMock.webhooks.constructEventAsync.mockImplementation(async (_b: string, _s: string, secret: string) => {
        if (secret === "whsec_sandbox") return ev;
        throw new Error("No signatures found matching the expected signature for payload");
      });
      const fn = await loadEdgeFunction("stripe-webhook");
      const res = await fn.fetch(fn.request({ rawBody: JSON.stringify(ev), headers: { "stripe-signature": "t=1,v1=x", "content-type": "application/json" } }));
      return { status: res.status, body: await json(res) };
    };
    const applied = () => scenario.writes.some((w) => w.table === "stripe_webhook_events");

    it("test donor to a test account passes routing and the gift check", async () => {
      env();
      enrol(TEST_BUYER, TEST_RECIPIENT);
      scenario.reads.profiles = { ...(scenario.reads.profiles ?? {}), rows: [{ user_id: TEST_RECIPIENT }] };
      const { body } = await deliverGift(TEST_BUYER, TEST_RECIPIENT_EMAIL);
      expect(body.ignored).not.toBe("test_checkout_not_routed");
      expect(body.ignored).not.toBe("test_gift_not_test_to_test");
      expect(body.ignored).not.toBe("test_event_names_real_account");
      expect(applied()).toBe(true);
    });

    it("a gift to an email with NO account is NOT applied (sandbox credit nobody may claim)", async () => {
      env();
      enrol(TEST_BUYER);
      scenario.reads.profiles = { ...(scenario.reads.profiles ?? {}), rows: [] };
      const { status, body } = await deliverGift(TEST_BUYER, "nobody.yet@example.com");
      expect(status).toBe(200);
      expect(body).toMatchObject({ ignored: "test_gift_not_test_to_test" });
      expect(applied()).toBe(false);
    });

    it("a gift whose DONOR is not a test account is NOT applied", async () => {
      env();
      enrol(TEST_RECIPIENT);
      scenario.reads.profiles = { ...(scenario.reads.profiles ?? {}), rows: [{ user_id: TEST_RECIPIENT }] };
      const { body } = await deliverGift(REAL_BUYER, TEST_RECIPIENT_EMAIL);
      expect(body).toMatchObject({ ignored: "test_gift_not_test_to_test" });
      expect(applied()).toBe(false);
    });

    it("a gift to a REAL account is NOT applied", async () => {
      env();
      enrol(TEST_BUYER);
      scenario.reads.profiles = { ...(scenario.reads.profiles ?? {}), rows: [{ user_id: REAL_RECIPIENT }] };
      const { body } = await deliverGift(TEST_BUYER, REAL_RECIPIENT_EMAIL);
      expect(String(body.ignored)).toMatch(/^(test_event_names_real_account|test_gift_not_test_to_test)$/);
      expect(applied()).toBe(false);
    });
  });
});
