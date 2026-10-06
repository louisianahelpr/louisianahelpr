/**
 * Q1324 (owner rules, 2026-10-05): a banned person's CARD or payout BANK on a
 * new account bans that account, through public.enforce_retained_payment_ban
 * (migration 20261006014801; its SQL behaviour is proven by
 * src/test/pglite/banEvasionCardBankName.pglite.mjs). This file pins the edge
 * half, running the REAL sources through the edge harness:
 *
 *   - stripe-webhook checkout.session.completed sends the card that PAID
 *     (expanded PaymentMethod card.fingerprint) for the PAYING account, after
 *     the session is settled;
 *   - stripe-connect `status` and stripe-webhook account.updated send every
 *     external account's fingerprint (bank -> 'bank', payout debit card ->
 *     'card') before the payout gate can open;
 *   - a match bans and pages an admin; a check that cannot run is NEVER read
 *     as "not banned": it pages (checkout), refuses to open the payout gate
 *     (status) or makes Stripe redeliver (account.updated);
 *   - a missing RPC (the function deployed before its migration) is a quiet
 *     no-op, not an outage.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | await checkCheckoutCardFingerprint(event, ctx); | void 0;
 * @mutate supabase/functions/_shared/paymentFingerprint.ts | const CHECKOUT_PAYER_KEYS = ["customer_id", "payer_id", "tipper_id", "user_id", "donor_id"] as const; | export const CHECKOUT_PAYER_KEYS = ["user_id", "donor_id"] as const;
 * @mutate supabase/functions/_shared/paymentFingerprint.ts | if (error.code === "PGRST202" \|\| error.code === "42883") return { kind: "not_deployed", message }; | return { kind: "not_deployed", message };
 * @mutate supabase/functions/_shared/paymentFingerprint.ts | return { kind: "failed", message: "enforce_retained_payment_ban returned no verdict" }; | return { kind: "ok", verdict: { banned: false, matched_on: null, already_banned: false } };
 * @mutate supabase/functions/_shared/paymentFingerprint.ts | const kind: FingerprintKind \| null = object === "bank_account" ? "bank" : object === "card" ? "card" : null; | const kind: FingerprintKind \| null = object === "card" ? "card" : null;
 * @mutate supabase/functions/stripe-webhook/handlers/_checkoutCardFingerprint.ts | await reportNotChecked(session.id, payer, check.message);\n    return; | return;
 * @mutate supabase/functions/stripe-connect/index.ts | const { data: cacheRows, error: cacheErr } = fpCheckFailed && !wasEnabled | const { data: cacheRows, error: cacheErr } = false
 * @mutate supabase/functions/stripe-connect/index.ts | if (fpCheck.kind === "banned") {\n        await postSlackOpsAlert({ | if (false) {\n        await postSlackOpsAlert({
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | if (fpCheck.kind === "failed") {\n    throw | if (false) {\n    throw
 * @mutate supabase/functions/stripe-webhook/handlers/accountUpdated.ts | const fpCheck = await enforceConnectAccountFingerprints(stripe, supabase, helperProfile.user_id, account); | const fpCheck = { kind: "clear", checked: 0 } as { kind: string; message?: string; matched_on?: string; already_banned?: boolean };
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

const PAYER = "7a1c0e3b-1111-4a2b-9c3d-000000000001";
const HELPR = "7a1c0e3b-2222-4a2b-9c3d-000000000002";
const ACCT = "acct_q1324";
const RPC = "enforce_retained_payment_ban";
type Alert = { kind?: string; severity?: string; title: string; fields?: Record<string, unknown> };
const alerts = () => slackAlerts as Alert[];
const rpcCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === RPC);
const cacheWrites = () =>
  scenario.writes.filter(
    (w) => w.table === "profiles" && w.op === "update" && "stripe_payouts_enabled" in ((w.payload as Record<string, unknown>) ?? {}),
  );
const NOT_BANNED = { banned: false, matched_on: null };
const BANNED_CARD = { banned: true, matched_on: "card", already_banned: false };
const BANNED_BANK = { banned: true, matched_on: "bank", already_banned: false };

function webhookEnv() {
  resetSupabaseMock();
  resetSharedMocks();
  resetStripeMock();
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
}

async function deliver(type: string, object: Record<string, unknown>) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: `evt_q1324_${type}`, type, data: { object } });
  const fn = await loadEdgeFunction("stripe-webhook");
  return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
}

// A session the settlement half acknowledges without touching the DB (no
// customer email), so these tests see only the card check.
const session = (over: Record<string, unknown> = {}) => ({
  id: "cs_q1324",
  mode: "payment",
  payment_intent: "pi_q1324",
  metadata: { customer_id: PAYER, job_id: "job-q1324" },
  ...over,
});
const piWithCard = (fingerprint: string | null) => ({
  id: "pi_q1324",
  payment_method: { id: "pm_1", type: "card", card: fingerprint === null ? { brand: "visa" } : { brand: "visa", fingerprint } },
});

describe("Q1324 — the card that paid a checkout is checked against banned people's cards", () => {
  beforeEach(webhookEnv);
  afterEach(() => resetEnv());

  it("sends the PAYING account and the card fingerprint, after expanding the PaymentMethod", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard("fpCardQ1324"));
    scenario.rpc[RPC] = NOT_BANNED;

    const res = await deliver("checkout.session.completed", session());

    expect(res.status).toBe(200);
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_q1324", { expand: ["payment_method"] });
    expect(rpcCalls(), "inventory floor: the check ran").toHaveLength(1);
    expect(rpcCalls()[0].args).toEqual({ p_user_id: PAYER, p_kind: "card", p_stripe_fingerprint: "fpCardQ1324" });
    expect(alerts()).toHaveLength(0);
  });

  it("each checkout kind's payer key is read (tip, recurring visit, gift card, Pro)", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard("fpCardQ1324"));
    scenario.rpc[RPC] = NOT_BANNED;
    for (const metadata of [{ tipper_id: PAYER }, { donor_id: PAYER }, { user_id: PAYER }]) {
      scenario.rpcCalls = [];
      await deliver("checkout.session.completed", session({ metadata }));
      expect(rpcCalls().map((c) => (c.args as { p_user_id: string }).p_user_id)).toEqual([PAYER]);
    }
  });

  it("a match pages an admin (the RPC has already banned the account)", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard("fpBanned"));
    scenario.rpc[RPC] = BANNED_CARD;

    const res = await deliver("checkout.session.completed", session());

    expect(res.status).toBe(200);
    const page = alerts().find((a) => /banned person's card paid a checkout/.test(a.title));
    expect(page?.kind).toBe("fraud_flag");
    expect(page?.fields).toMatchObject({ user_id: PAYER, session_id: "cs_q1324" });
  });

  it("an RPC error is NEVER 'not banned': it pages critical, and the payment stays recorded (200)", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard("fpCardQ1324"));
    scenario.rpcErrors = { [RPC]: { message: "ban_fingerprint_salt: vault secret is missing", code: "P0001" } };

    const res = await deliver("checkout.session.completed", session());

    expect(res.status).toBe(200);
    const page = alerts().find((a) => /card check did not run/.test(a.title));
    expect(page?.severity).toBe("critical");
    expect(String(page?.fields?.reason)).toMatch(/vault secret is missing/);
  });

  it("a null error with no verdict is a failure too, not a pass", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard("fpCardQ1324"));
    scenario.rpc[RPC] = null;

    await deliver("checkout.session.completed", session());

    expect(alerts().some((a) => /card check did not run/.test(a.title))).toBe(true);
  });

  it("a PaymentIntent that cannot be read pages (the check did not run)", async () => {
    stripeMock.paymentIntents.retrieve.mockRejectedValue(Object.assign(new Error("rate limited"), { statusCode: 429 }));

    const res = await deliver("checkout.session.completed", session());

    expect(res.status).toBe(200);
    expect(rpcCalls()).toHaveLength(0);
    expect(alerts().some((a) => /card check did not run/.test(a.title) && a.severity === "critical")).toBe(true);
  });

  it("the RPC not deployed yet (PGRST202) is a quiet no-op", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard("fpCardQ1324"));
    scenario.rpcErrors = { [RPC]: { message: "Could not find the function", code: "PGRST202" } };

    const res = await deliver("checkout.session.completed", session());

    expect(res.status).toBe(200);
    expect(alerts()).toHaveLength(0);
  });

  it("no card (an unexpanded id, a non-card method, no fingerprint, no payer) sends nothing", async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_q1324", payment_method: "pm_1" });
    await deliver("checkout.session.completed", session());
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard(null));
    await deliver("checkout.session.completed", session());
    stripeMock.paymentIntents.retrieve.mockResolvedValue(piWithCard("fpCardQ1324"));
    await deliver("checkout.session.completed", session({ metadata: { customer_id: "not-a-uuid" } }));
    expect(rpcCalls()).toHaveLength(0);
    expect(alerts()).toHaveLength(0);
  });

  it("a subscription checkout reads the subscription's default card", async () => {
    stripeMock.subscriptions.retrieve.mockResolvedValue({
      id: "sub_1",
      items: { data: [] },
      default_payment_method: { id: "pm_2", card: { fingerprint: "fpSubCard" } },
    });
    scenario.rpc[RPC] = NOT_BANNED;

    await deliver("checkout.session.completed", session({ mode: "subscription", payment_intent: null, subscription: "sub_1", metadata: { user_id: PAYER } }));

    expect(stripeMock.subscriptions.retrieve).toHaveBeenCalledWith("sub_1", { expand: ["default_payment_method"] });
    expect(rpcCalls().map((c) => c.args)).toContainEqual({ p_user_id: PAYER, p_kind: "card", p_stripe_fingerprint: "fpSubCard" });
  });
});

// ─── payout accounts ───────────────────────────────────────────────────────
const ENABLED = {
  id: ACCT,
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  capabilities: { transfers: "active" },
  requirements: { currently_due: [], eventually_due: [], past_due: [], errors: [] },
};
const withExternal = (data: unknown[]) => ({ ...ENABLED, external_accounts: { object: "list", data } });
const BANK = { id: "ba_1", object: "bank_account", fingerprint: "fpBankQ1324", last4: "6789" };
const DEBIT = { id: "card_1", object: "card", fingerprint: "fpDebitQ1324", last4: "4242" };

describe("Q1324 — stripe-connect `status` checks the payout accounts before the gate opens", () => {
  function onFile(enabled: boolean) {
    scenario.reads.profiles = {
      rows: [{
        stripe_account_id: ACCT,
        stripe_identity_verified: enabled,
        stripe_charges_enabled: enabled,
        stripe_payouts_enabled: enabled,
      }],
    };
  }
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
    scenario.authUser = { id: HELPR, email: "helpr-q1324@example.test" };
    onFile(false);
  });
  afterEach(() => resetEnv());

  async function status() {
    const fn = await loadEdgeFunction("stripe-connect");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer good" }, body: { action: "status" } }));
  }

  it("sends every bank account and payout debit card on the account, for the caller", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(withExternal([BANK, DEBIT]));
    scenario.rpc[RPC] = NOT_BANNED;

    const res = await status();

    expect(res.status).toBe(200);
    expect(rpcCalls().map((c) => c.args)).toEqual([
      { p_user_id: HELPR, p_kind: "bank", p_stripe_fingerprint: "fpBankQ1324" },
      { p_user_id: HELPR, p_kind: "card", p_stripe_fingerprint: "fpDebitQ1324" },
    ]);
    expect(cacheWrites(), "a clear check still opens the gate").toHaveLength(1);
  });

  it("lists the external accounts when the account object does not carry them", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    stripeMock.accounts.listExternalAccounts.mockResolvedValue({ data: [BANK] });
    scenario.rpc[RPC] = NOT_BANNED;

    await status();

    expect(stripeMock.accounts.listExternalAccounts).toHaveBeenCalledWith(ACCT, { limit: 100 });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("a banned person's bank: 403 with a plain message, the gate is NOT opened, an admin is paged", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(withExternal([BANK]));
    scenario.rpc[RPC] = BANNED_BANK;

    const res = await status();
    const body = JSON.parse(await res.text());

    expect(res.status).toBe(403);
    expect(body.error).toBe("This payout account can't be used. Please contact support.");
    expect(JSON.stringify(body)).not.toMatch(/bank|banned|matched/i);
    expect(cacheWrites()).toHaveLength(0);
    expect(alerts().some((a) => a.kind === "fraud_flag" && /payout account was attached/.test(a.title))).toBe(true);
  });

  it("a check that cannot run pages and does not open the gate for a Helpr not yet payable", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(withExternal([BANK]));
    scenario.rpcErrors = { [RPC]: { message: "connection reset", code: "08006" } };

    const res = await status();

    expect(res.status).toBe(200);
    expect(cacheWrites()).toHaveLength(0);
    expect(alerts().some((a) => a.severity === "critical" && /payout-account check did not run/.test(a.title))).toBe(true);
  });

  it("…but a Helpr already payable keeps the normal cache write (nobody is shut out by an outage)", async () => {
    onFile(true);
    stripeMock.accounts.retrieve.mockResolvedValue(withExternal([BANK]));
    scenario.rpcErrors = { [RPC]: { message: "connection reset", code: "08006" } };

    await status();

    expect(cacheWrites()).toHaveLength(1);
  });

  it("a failed external-account list is a failed check, not an empty one", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(ENABLED);
    stripeMock.accounts.listExternalAccounts.mockRejectedValue(new Error("stripe down"));

    await status();

    expect(cacheWrites()).toHaveLength(0);
    expect(alerts().some((a) => /payout-account check did not run/.test(a.title))).toBe(true);
  });
});

describe("Q1324 — account.updated checks the payout accounts before caching", () => {
  beforeEach(() => {
    webhookEnv();
    scenario.reads.profiles = {
      rows: [{
        user_id: HELPR,
        full_name: "Q1324 Helpr",
        email_verified: true,
        stripe_identity_verified: false,
        stripe_charges_enabled: false,
        stripe_payouts_enabled: false,
      }],
    };
  });
  afterEach(() => resetEnv());

  it("a banned person's bank: nothing is cached and an admin is paged", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(withExternal([BANK]));
    scenario.rpc[RPC] = BANNED_BANK;

    const res = await deliver("account.updated", { id: ACCT });

    expect(res.status).toBe(200);
    expect(rpcCalls()[0]?.args).toEqual({ p_user_id: HELPR, p_kind: "bank", p_stripe_fingerprint: "fpBankQ1324" });
    expect(cacheWrites()).toHaveLength(0);
    expect(alerts().some((a) => a.kind === "fraud_flag")).toBe(true);
  });

  it("a check that cannot run answers 500 before any write (Stripe redelivers)", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(withExternal([BANK]));
    scenario.rpcErrors = { [RPC]: { message: "connection reset", code: "08006" } };

    const res = await deliver("account.updated", { id: ACCT });

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(cacheWrites()).toHaveLength(0);
  });

  it("a clear check caches as before", async () => {
    stripeMock.accounts.retrieve.mockResolvedValue(withExternal([BANK]));
    scenario.rpc[RPC] = NOT_BANNED;

    const res = await deliver("account.updated", { id: ACCT });

    expect(res.status).toBe(200);
    expect(cacheWrites()).toHaveLength(1);
  });
});
