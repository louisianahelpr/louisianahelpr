/**
 * Q2453: the buyer tips the Helpr of a Declutter delivery that is done. Every rule about WHO may
 * tip WHAT lives in SQL (helpr_task_tip_start / _paid, proven by
 * src/test/pglite/helprTaskTips.pglite.mjs); this file runs the REAL edge sources through the
 * harness (Stripe and Supabase doubled: Stripe is LIVE on prod, nothing here reaches it) and
 * proves the money is the JOB tip's, line for line (create-payment action "tip", src/test/edge/create-payment.test.ts):
 *   - declutter-checkout delivery_tip: a DESTINATION charge to the Helpr's own account for
 *     tipChargeBreakdown's charge (tip + card fee, ONE line), application_fee_amount = the card fee,
 *     so the Helpr receives the whole tip and the platform keeps only what covers Stripe; card and
 *     Link only; the attempt keys the page; the same payout-account / payout-hold / ban-review refusals;
 *   - stripe-webhook: only a PAID tip page reaches helpr_task_tip_paid; a page SQL cannot tie to its
 *     row, a charge that is not the tip's total, and a tip that reached a held Helpr page staff;
 *   - owner #3706 (option 2): a Helpr with no payout account still gets the tip: the same charge, made
 *     on the platform (no destination, no application fee), HELD; declutter-money then sends exactly the
 *     tip from the tip's own charge with the delivery pay, as one more part, recorded on the tip.
 *
 * Registered mutations - each turns this file RED on its own:
 * @mutate supabase/functions/declutter-checkout/index.ts | application_fee_amount: q.feeCents }), | application_fee_amount: q.feeCents + 50 }),
 * @mutate supabase/functions/declutter-checkout/index.ts |          unit_amount: q.chargeCents, |          unit_amount: q.tipCents,
 * @mutate supabase/functions/declutter-checkout/index.ts | { transfer_data: { destination: account as string }, application_fee_amount: q.feeCents }), | { application_fee_amount: q.feeCents }),
 * @mutate supabase/functions/declutter-checkout/index.ts |      payment_method_types: TIP_PAYMENT_METHOD_TYPES, |
 * @mutate supabase/functions/declutter-checkout/index.ts |  if (hold.kind === "held" \|\| review.users.has(helprId)) { |  if (false) {
 * @mutate supabase/functions/declutter-checkout/index.ts |  if (!held && !account) { |  if (false) {
 * @mutate supabase/functions/declutter-checkout/index.ts |  if (review.users.has(user.id)) return | if (false) return
 * @mutate supabase/functions/declutter-checkout/index.ts |    }, { idempotencyKey: `delivery-tip-${tip.tip_id}-c${q.chargeCents}` }); |    });
 * @mutate supabase/functions/declutter-checkout/index.ts |  const tipSwitchOff = await requireFeature(admin, "declutter", user, corsHeaders);\n  if (tipSwitchOff) return tipSwitchOff;\n |
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |  if (session.payment_status !== "paid") {\n    logStep("Declutter delivery tip session completed unpaid" |  if (false) {\n    logStep("Declutter delivery tip session completed unpaid"
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |    if (hold.kind === "held") { |    if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |  if (answer.helpr_id && answer.held !== true) {\n    const hold = await checkPayoutHold | if (answer.result === "paid" && answer.helpr_id && answer.held !== true) {\n    const hold = await checkPayoutHold
 * @mutate supabase/functions/declutter-checkout/index.ts | tip_id: tip.tip_id, tipper_id: user.id, held: held ? "1" : "0", tip_cents | tip_id: tip.tip_id, held: held ? "1" : "0", tip_cents
 * @mutate supabase/functions/_shared/stripeMode.ts | "declutter_raise", "declutter_delivery_tip", | "declutter_raise",
 * @mutate supabase/functions/declutter-checkout/index.ts |        ...(held ? {} : { transfer_data: { destination: account as string }, application_fee_amount: q.feeCents }), |        ...({ transfer_data: { destination: account as string }, application_fee_amount: q.feeCents }),
 * @mutate supabase/functions/declutter-money/index.ts | , ...heldTipParts(h.tip_parts)]; | ];
 * @mutate supabase/functions/declutter-money/index.ts |                 : part.tipId ? `helpr-task-payout-${h.payout_id}-tip-${part.tipId}` : `helpr-task-payout-${h.payout_id}`, |                 : `helpr-task-payout-${h.payout_id}`,
 * @mutate supabase/functions/declutter-money/index.ts |          && (meta.raise_id ?? "") === (part.raiseId ?? "") && (meta.tip_id ?? "") === (part.tipId ?? ""); |          && (meta.raise_id ?? "") === (part.raiseId ?? "");
 * @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts |  if (answer.held === true && answer.attached === false) { |  if (false) {
 * @mutate supabase/functions/declutter-money/index.ts |            if (!part.tipId \|\| isTransientStripeError(e)) throw e; |            throw e;
 * @mutate supabase/functions/declutter-money/index.ts |    const stranded = await admin.rpc("helpr_task_tips_stranded", {}); |    const stranded = { data: [], error: null };
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { resetStripeMock, stripeMock } from "./mocks/stripe";
import { resetEmailMocks } from "./mocks/email";
import { isRoutedTestCheckout } from "../../../supabase/functions/_shared/stripeMode";
import { tipChargeBreakdown } from "../../../supabase/functions/_shared/tipFees";

const BUYER = "0000000d-0000-4000-8000-000000000001";
const HELPR = "0000000d-0000-4000-8000-000000000003";
const TASK = "0000000d-0000-4000-8000-0000000000bb";
const TIP = "0000000d-0000-4000-8000-0000000000dd";
const ATTEMPT = "0000000d-0000-4000-8000-0000000000ee";

function env() {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_declutter",
    STRIPE_TEST_SECRET_KEY: "sk_test_declutter",
    STRIPE_WEBHOOK_SECRET: "whsec_live",
  });
}
const rpcs = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);
const titles = () => (slackAlerts as Array<{ title?: unknown }>).map((a) => String(a.title));

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
  resetEmailMocks();
  scenario.reads.test_accounts = { rows: [] };
  scenario.reads.ban_settlement_queue = { rows: [] };
  scenario.reads.payout_holds = { rows: [] };
});

describe("declutter-checkout: delivery_tip", () => {
  async function call(body: Record<string, unknown> = {}) {
    env();
    scenario.authUser = { id: BUYER, email: "buyer@test.dev" };
    const fn = await loadEdgeFunction("declutter-checkout");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer buyer-jwt" },
      body: { action: "delivery_tip", task_id: TASK, tip_cents: 1000, tip_attempt_id: ATTEMPT, ...body } }));
  }
  const started = { tip_id: TIP, helpr_id: HELPR, tip_cents: 1000, title: "Oak dresser", payment_status: "pending", stripe_session_id: null };
  function ready(over: { profiles?: Record<string, unknown>[] } = {}) {
    scenario.rpc.feature_enabled_for_user = true;
    scenario.rpc.helpr_task_tip_start = started;
    scenario.rpc.helpr_task_tip_attach = true;
    scenario.reads.profiles = { rows: over.profiles ?? [{ user_id: HELPR, stripe_account_id: "acct_helpr1" }] };
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_tip", url: "https://checkout.stripe.test/tip" });
  }

  it("the job tip's money exactly: a destination charge for tip + card fee on one line, the fee as the application fee, the Helpr gets the whole tip", async () => {
    ready();
    const res = await call();
    expect(res.status).toBe(200);
    expect(JSON.parse(await res.text()).url).toBe("https://checkout.stripe.test/tip");
    expect(rpcs("helpr_task_tip_start")[0]?.args).toEqual({ p_task_id: TASK, p_tip_cents: 1000, p_attempt_id: ATTEMPT });
    const q = tipChargeBreakdown(1000);
    expect(q.helperCents).toBe(1000);
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.mode).toBe("payment");
    expect(params.line_items).toHaveLength(1);
    expect(params.line_items[0].price_data.unit_amount).toBe(q.chargeCents);
    expect(params.line_items[0].price_data.unit_amount).toBe(1000 + q.feeCents);
    expect(params.line_items[0].price_data.product_data.name).toBe("Tip — Oak dresser");
    // No fee word on the page (owner 2026-10-25; members never see a fee number).
    expect(JSON.stringify(params.line_items)).not.toMatch(/fee|processing/i);
    expect(params.payment_intent_data.transfer_data).toEqual({ destination: "acct_helpr1" });
    expect(params.payment_intent_data.application_fee_amount).toBe(q.feeCents);
    // Stripe moves charge - application fee to the Helpr: exactly the tip.
    expect(params.line_items[0].price_data.unit_amount - params.payment_intent_data.application_fee_amount).toBe(1000);
    expect(params.payment_method_types).toEqual(["card", "link"]);
    expect(params.metadata).toMatchObject({ kind: "declutter_delivery_tip", tip_id: TIP, task_id: TASK, tipper_id: BUYER, helpr_id: HELPR, tip_cents: "1000", charge_cents: String(q.chargeCents) });
    expect(params.metadata.job_id).toBeUndefined();
    // The PaymentIntent names who paid, so a refund or dispute notice reaches them.
    expect(params.payment_intent_data.metadata).toMatchObject({ kind: "declutter_delivery_tip", tip_id: TIP, tipper_id: BUYER });
    expect(opts).toEqual({ idempotencyKey: `delivery-tip-${TIP}-c${q.chargeCents}` });
    expect(rpcs("helpr_task_tip_attach")[0]?.args).toEqual({ p_tip_id: TIP, p_session_id: "cs_live_tip" });
  });

  it("owner #3706: a Helpr with no payout account still gets the tip, held: the same charge, on the platform, no application fee", async () => {
    ready({ profiles: [{ user_id: HELPR, stripe_account_id: null }] });
    scenario.rpc.helpr_task_tip_start = { ...started, held: true };
    const res = await call();
    expect(res.status).toBe(200);
    const q = tipChargeBreakdown(1000);
    const [params, opts] = stripeMock.checkout.sessions.create.mock.calls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(q.chargeCents);
    expect(params.payment_intent_data.transfer_data).toBeUndefined();
    expect(params.payment_intent_data.application_fee_amount).toBeUndefined();
    expect(params.payment_intent_data.metadata).toMatchObject({ kind: "declutter_delivery_tip", tip_id: TIP, held: "1", tip_cents: "1000" });
    expect(params.payment_method_types).toEqual(["card", "link"]);
    expect(opts).toEqual({ idempotencyKey: `delivery-tip-${TIP}-c${q.chargeCents}` });
  });

  it("a row NOT held whose Helpr has no payout account (a race): the job tip's refusal, no page", async () => {
    ready({ profiles: [{ user_id: HELPR, stripe_account_id: null }] });
    const res = await call();
    expect(res.status).toBe(400);
    expect(JSON.parse(await res.text()).error).toBe("tip_helpr_no_payout");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  // The destination charge is not live-gated (everyTransferToAHelprIsLiveGated: Stripe refuses a destination it
  // cannot pay before any money moves). That refusal is a plain reply, an ops alert and no recorded page, as the
  // job tip's. Stripe-refused, handled.
  // @mutate supabase/functions/declutter-checkout/index.ts |     if (refused) return json({ error: "tip_not_sent" }, 409); |     if (false) return json({ error: "tip_not_sent" }, 409);
  it("a Helpr whose account Stripe refuses: tip_not_sent, an ops alert, no page recorded (Stripe-refused, handled)", async () => {
    ready();
    stripeMock.checkout.sessions.create.mockRejectedValue(Object.assign(
      new Error("Your destination account needs to have at least one of the following capabilities enabled: transfers, crypto_transfers, legacy_payments"),
      { type: "StripeInvalidRequestError", statusCode: 400 },
    ));
    const res = await call();
    expect(res.status).toBe(409);
    expect(JSON.parse(await res.text()).error).toBe("tip_not_sent");
    expect(rpcs("helpr_task_tip_attach")).toHaveLength(0);
    expect((slackAlerts as Array<{ oncePerDayKey?: string }>).some((a) => a.oncePerDayKey === `destination-charge-refused-${HELPR}`)).toBe(true);
  });

  it("a Helpr on a payout hold: the job tip's payout-held reply, no page", async () => {
    ready();
    scenario.reads.payout_holds = { rows: [{ helper_id: HELPR, reason: "review", held_at: "2026-10-27T00:00:00Z", denied_at: null }] };
    const res = await call();
    expect(res.status).toBe(409);
    expect(JSON.parse(await res.text())).toEqual({ error: "tip_helpr_held", code: "payout_held" });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a Helpr who has not verified their ID: refused, no page, no money", async () => {
    ready();
    scenario.rpc.payout_waits_on_identity = true;
    const res = await call();
    expect(res.status).toBe(409);
    expect(JSON.parse(await res.text())).toEqual({ error: "tip_waits_on_identity" });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("the ID check unreadable: fails closed, no page", async () => {
    ready();
    scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), payout_waits_on_identity: { message: "connection reset", code: "08006" } };
    const res = await call();
    expect(res.status).toBe(500);
    expect(JSON.parse(await res.text())).toEqual({ error: "tip_check_failed" });
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a buyer under a ban review is told to contact support, no page", async () => {
    ready();
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: BUYER }] };
    const res = await call();
    expect(res.status).toBe(403);
    expect(JSON.parse(await res.text()).error).toBe("payment_review");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("the hidden switch off: refused before the SQL or Stripe is asked", async () => {
    ready();
    scenario.rpc.feature_enabled_for_user = false;
    const res = await call();
    expect(res.status).toBe(403);
    expect(rpcs("helpr_task_tip_start")).toHaveLength(0);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("an amount outside $3..$1,000, a fraction of a cent or no attempt id: refused before anything", async () => {
    ready();
    // Request bodies the function must refuse, not helpr_task_tips rows: built from bare amounts so
    // fixtureSchemaContract (which grades a `tip_cents: <n>` literal against the table's CHECK) does not
    // read them as impossible rows.
    const badAmounts = [299, 100_001, 500.5].map((tip_cents) => ({ tip_cents }));
    for (const body of [...badAmounts, { tip_attempt_id: "x" }]) {
      const res = await call(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(rpcs("helpr_task_tip_start")).toHaveLength(0);
  });

  it("a SQL refusal is passed on as its code (not the buyer's delivery, not done yet)", async () => {
    ready();
    scenario.rpcErrors = { helpr_task_tip_start: { message: "tip_not_yet", code: "55000" } };
    const res = await call();
    expect(res.status).toBe(409);
    expect(JSON.parse(await res.text()).error).toBe("tip_not_yet");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a row that already has a page returns that page while open, never a second page", async () => {
    ready();
    scenario.rpc.helpr_task_tip_start = { ...started, stripe_session_id: "cs_live_old" };
    // A Stripe Checkout Session (its status last: fixturePaymentStatus pairs a `status` with the next
    // payment_status within 900 chars and would read this session plus the paid tip row below as one jobs row).
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({ id: "cs_live_old", url: "https://x/old", status: "open" });
    const res = await call();
    expect(JSON.parse(await res.text()).url).toBe("https://x/old");
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("a tip already paid opens nothing", async () => {
    ready();
    scenario.rpc.helpr_task_tip_start = { ...started, payment_status: "paid" };
    const res = await call();
    expect(res.status).toBe(409);
    expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();
  });
});

describe("stripe-webhook: a delivery tip page completed", () => {
  const q = tipChargeBreakdown(1000);
  async function deliver(session: Record<string, unknown>, answer: unknown = { result: "paid", tip_id: TIP, helpr_id: HELPR, tip_cents: 1000 }) {
    env();
    const fn = await loadEdgeFunction("stripe-webhook");
    stripeMock.webhooks.constructEventAsync.mockResolvedValue({
      id: "evt_tip_1", type: "checkout.session.completed", livemode: true, created: 1_760_000_000,
      data: { object: {
        id: "cs_live_tip", mode: "payment", payment_status: "paid", payment_intent: "pi_tip", amount_total: q.chargeCents,
        metadata: { kind: "declutter_delivery_tip", tip_id: TIP, task_id: TASK, tipper_id: BUYER, helpr_id: HELPR, tip_cents: "1000", charge_cents: String(q.chargeCents) },
        ...session,
      } },
    });
    scenario.rpc.helpr_task_tip_paid = answer;
    scenario.reads.profiles = { rows: [{ email: "buyer@test.dev", user_id: BUYER }] };
    return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=x" } }));
  }

  it("a PAID page is recorded by SQL with the page, the payment and what Stripe charged; no job is touched", async () => {
    const res = await deliver({});
    expect(res.status).toBe(200);
    expect(rpcs("helpr_task_tip_paid")[0]?.args).toEqual({ p_tip_id: TIP, p_session_id: "cs_live_tip", p_payment_intent_id: "pi_tip", p_charged_cents: q.chargeCents });
    expect(rpcs("declutter_mark_order_paid")).toHaveLength(0);
    expect(slackAlerts).toHaveLength(0);
  });

  it("an UNPAID completion changes nothing", async () => {
    await deliver({ payment_status: "unpaid" });
    expect(rpcs("helpr_task_tip_paid")).toHaveLength(0);
  });

  it("a page SQL cannot tie to its row pages staff", async () => {
    await deliver({}, { result: "session_mismatch", tip_id: TIP });
    expect(titles().some((t) => /tip paid but not recorded/.test(t))).toBe(true);
  });

  it("a charge that is not the tip's own total pages staff", async () => {
    await deliver({ amount_total: q.chargeCents + 100 });
    expect(titles().some((t) => /different amount than its tip/.test(t))).toBe(true);
  });

  it("a tip that reached a Helpr put on a payout hold after the page opened pages staff", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: HELPR, reason: "review", held_at: "2026-10-27T00:00:00Z", denied_at: null }] };
    await deliver({});
    expect(titles().some((t) => /reached a Helpr on a payout hold/.test(t))).toBe(true);
  });

  it("owner #3706: a held tip whose delivery pay no longer waits pages staff to pay it by hand", async () => {
    await deliver({}, { result: "paid", tip_id: TIP, helpr_id: HELPR, tip_cents: 1000, held: true, attached: false });
    expect(titles().some((t) => /held delivery tip has no delivery pay to go with/.test(t))).toBe(true);
  });

  it("owner #3706: a held tip stays on the platform, so a payout hold pages nobody here (declutter-money checks it before sending)", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: HELPR, reason: "review", held_at: "2026-10-27T00:00:00Z", denied_at: null }] };
    await deliver({}, { result: "paid", tip_id: TIP, helpr_id: HELPR, tip_cents: 1000, held: true, attached: true });
    expect(slackAlerts).toHaveLength(0);
  });

  it("a replay is answered 'already' by SQL and pages nobody", async () => {
    await deliver({}, { result: "already", tip_id: TIP, helpr_id: HELPR, tip_cents: 1000 });
    expect(slackAlerts).toHaveLength(0);
  });

  it("a replay still reads the hold: a first delivery that failed on the hold read still pages (critical)", async () => {
    scenario.reads.payout_holds = { rows: [{ helper_id: HELPR, reason: "review", held_at: "2026-10-27T00:00:00Z", denied_at: null }] };
    await deliver({}, { result: "already", tip_id: TIP, helpr_id: HELPR, tip_cents: 1000 });
    const a = (slackAlerts as Array<{ title?: unknown; severity?: unknown; message?: unknown }>).find((x) => /reached a Helpr on a payout hold/.test(String(x.title)));
    expect(a?.severity).toBe("critical");
    expect(String(a?.message)).toMatch(/\$10\.00 delivery tip/);
  });

  it("a TEST-mode tip page is routed (test accounts tip on the test key)", () => {
    expect(isRoutedTestCheckout({ mode: "payment", metadata: { kind: "declutter_delivery_tip", tip_id: TIP } })).toBe(true);
  });
});

describe("declutter-money: a held delivery tip goes with the delivery pay (owner #3706)", () => {
  const PAYOUT = "0000000d-0000-4000-8000-0000000000cc";
  const ORDER = "0000000d-0000-4000-8000-0000000000aa";
  const SELLER = "0000000d-0000-4000-8000-000000000002";
  const helprRow = (over: Record<string, unknown> = {}) => ({
    payout_id: PAYOUT, task_id: TASK, source_kind: "declutter_delivery", source_id: ORDER, helpr_id: HELPR,
    customer_id: BUYER, pickup_contact_id: SELLER, amount_cents: 2200, stripe_account_id: "acct_helpr1",
    payment_intent_id: "pi_order1", transfer_group: `declutter_order_${ORDER}`, refunds_recorded_cents: 0, attempts: 0,
    raised_cents: 0, raise_parts: [], tip_parts: [{ tip_id: TIP, payment_intent_id: "pi_tip1", cents: 1000 }], ...over,
  });
  async function run(rows: unknown[]) {
    env();
    scenario.rpc.declutter_payouts_due = [];
    scenario.rpc.declutter_refunds_due = [];
    scenario.rpc.declutter_delivery_refunds_due = [];
    scenario.rpc.helpr_task_payouts_due = rows;
    scenario.rpc.declutter_delivery_raise_refunds_due = [];
    scenario.rpc.helpr_task_payout_executed = (a: { p_succeeded?: boolean }) => (a?.p_succeeded ? "succeeded" : "failed");
    scenario.rpc.helpr_task_tip_payout_sent = "recorded";
    scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }] };
    stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => ({
      id, status: "succeeded", latest_charge: { id: id === "pi_tip1" ? "ch_tip1" : "ch_order1", amount_refunded: 0, disputed: false },
    }));
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helpr1", capabilities: { transfers: "active" }, payouts_enabled: true });
    let n = 0;
    stripeMock.transfers.create.mockImplementation(async () => ({ id: `tr_new${++n}`, destination: "acct_helpr1" }));
    const fn = await loadEdgeFunction("declutter-money");
    const res = await fn.fetch(fn.request({ url: "https://edge.test/declutter-money", headers: { Authorization: "Bearer service-key" }, body: {} }));
    return { status: res.status, body: JSON.parse(await res.text()) as Record<string, any> };
  }

  it("the delivery pay, then EXACTLY the tip from the tip's own charge, each its own transfer; the tip's is recorded on the tip", async () => {
    const { status, body } = await run([helprRow()]);
    expect(status).toBe(200);
    expect(body.helpr_payouts_sent).toBe(1);
    const calls = stripeMock.transfers.create.mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({ amount: 2200, source_transaction: "ch_order1", destination: "acct_helpr1", metadata: { kind: "helpr_task_payout", payout_id: PAYOUT } });
    expect(calls[0][0].metadata.tip_id).toBeUndefined();
    expect(calls[1][0]).toMatchObject({ amount: 1000, source_transaction: "ch_tip1", destination: "acct_helpr1", transfer_group: `declutter_order_${ORDER}`,
      metadata: { kind: "helpr_task_payout", payout_id: PAYOUT, tip_id: TIP } });
    expect(calls[1][1]).toEqual({ idempotencyKey: `helpr-task-payout-${PAYOUT}-tip-${TIP}` });
    expect(rpcs("helpr_task_tip_payout_sent")[0]?.args).toEqual({ p_tip_id: TIP, p_transfer_id: "tr_new2" });
    expect(rpcs("helpr_task_payout_executed")[0]?.args).toMatchObject({ p_payout_id: PAYOUT, p_transfer_id: "tr_new1", p_succeeded: true });
  });

  it("a tip transfer Stripe already holds is adopted, never sent twice", async () => {
    stripeMock.transfers.list.mockResolvedValue({ data: [
      { id: "tr_old_order", metadata: { kind: "helpr_task_payout", payout_id: PAYOUT }, reversed: false },
      { id: "tr_old_tip", metadata: { kind: "helpr_task_payout", payout_id: PAYOUT, tip_id: TIP }, reversed: false },
    ] });
    const { body } = await run([helprRow()]);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(body.helpr_payouts_reconciled).toBe(1);
    expect(rpcs("helpr_task_tip_payout_sent")[0]?.args).toEqual({ p_tip_id: TIP, p_transfer_id: "tr_old_tip" });
  });

  it("no payout account yet: nothing is sent, the delivery pay and the tip wait together", async () => {
    await run([helprRow({ stripe_account_id: null })]);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(rpcs("helpr_task_tip_payout_sent")).toHaveLength(0);
  });

  it("a refunded or disputed tip charge never holds up the delivery pay: the pay goes, the tip waits for staff", async () => {
    stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => ({
      id, status: "succeeded", latest_charge: id === "pi_tip1"
        ? { id: "ch_tip1", amount_refunded: 0, disputed: true }
        : { id: "ch_order1", amount_refunded: 0, disputed: false },
    }));
    // run() re-mocks paymentIntents.retrieve: re-apply the disputed tip charge after it, through the stranded list.
    env();
    scenario.rpc.declutter_payouts_due = [];
    scenario.rpc.declutter_refunds_due = [];
    scenario.rpc.declutter_delivery_refunds_due = [];
    scenario.rpc.helpr_task_payouts_due = [helprRow()];
    scenario.rpc.declutter_delivery_raise_refunds_due = [];
    scenario.rpc.helpr_task_payout_executed = "succeeded";
    scenario.reads.profiles = { rows: [{ user_id: BUYER, email: "buyer@example.test" }] };
    stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helpr1", capabilities: { transfers: "active" }, payouts_enabled: true });
    stripeMock.transfers.create.mockResolvedValue({ id: "tr_pay1", destination: "acct_helpr1" });
    const fn = await loadEdgeFunction("declutter-money");
    await fn.fetch(fn.request({ url: "https://edge.test/declutter-money", headers: { Authorization: "Bearer service-key" }, body: {} }));
    const calls = stripeMock.transfers.create.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toMatchObject({ amount: 2200, source_transaction: "ch_order1" });
    expect(rpcs("helpr_task_tip_payout_sent")).toHaveLength(0);
    expect(rpcs("helpr_task_payout_executed")[0]?.args).toMatchObject({ p_payout_id: PAYOUT, p_succeeded: true });
    expect(titles().some((x) => /held delivery tip's charge is not whole/.test(x))).toBe(true);
  });

  it("a held tip nothing will send (its payout went without it, gave up, or was settled by hand) pages staff", async () => {
    scenario.rpc.helpr_task_tips_stranded = [{ tip_id: TIP, task_id: TASK, helpr_id: HELPR, tip_cents: 1000, payment_intent_id: "pi_tip1", payout_status: "settled_by_hand" }];
    await run([]);
    expect(titles().some((x) => /held delivery tip will not be sent automatically/.test(x))).toBe(true);
  });

  it("a malformed tip part is a data defect: nothing is sent", async () => {
    await run([helprRow({ tip_parts: [{ tip_id: TIP, payment_intent_id: "ch_bad", cents: 1000 }] })]);
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
  });
});
