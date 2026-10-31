/**
 * Refund alerts about test data go to the daily digest, never to Slack.
 *
 * THE BUG (lead 10-30, SEED-ALERTS): chargeRefunded.ts declared "pages for seed
 * jobs too, on purpose", and none of its alerts or _giftCardRefund.ts's carried
 * `seed`, so a test job's refund paged the owner, against "test data never
 * reaches the owner". postSlackOpsAlert routes `seed: true` to the digest.
 *
 * The class half reads every postSlackOpsAlert call in the two files, so the
 * next alert added there cannot forget the flag. The behaviour half runs the
 * real handler: a seed subject is flagged, a real one is not, and a failed read
 * of the flag still pages as real.
 *
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | subjectIsSeed = (refundedJob as { is_seed?: boolean \| null }).is_seed === true\n        \|\| await anyIsTestSubject(supabase, [refundedJob.customer_id, refundedJob.helper_id], logStep); | subjectIsSeed = false;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | [refundedJob.customer_id, refundedJob.helper_id] | [refundedJob.customer_id]
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | [order?.buyer_id, order?.seller_id] | []
 * @mutate supabase/functions/stripe-webhook/handlers/_giftCardRefund.ts | ?.is_seed === true \|\| await anyIsTestSubject(supabase, [donorId], logStep); | ?.is_seed === true;
 * @mutate supabase/functions/stripe-webhook/handlers/_testSubject.ts |     if (data === true) return true; |     if (data === true) return false;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | subjectIsSeed = (partialJob as { is_seed?: boolean \| null }).is_seed === true\n          \|\| await anyIsTestSubject(supabase, [partialJob.customer_id, (partialJob as { helper_id?: string \| null }).helper_id], logStep); | subjectIsSeed = false;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | if (job.is_seed) return; | if (false) return;
 * @mutate supabase/functions/stripe-webhook/handlers/_giftCardRefund.ts | return (data as { is_seed?: boolean } \| null)?.is_seed === true \|\| await anyIsTestSubject(supabase, [donorId], logStep); | return false;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts | orderIsSeed ??= await shopOrderIsSeed(orderId, supabase, logStep); | orderIsSeed ??= false;
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

const FILES = [
  "supabase/functions/stripe-webhook/handlers/chargeRefunded.ts",
  "supabase/functions/stripe-webhook/handlers/_giftCardRefund.ts",
];

/** The source of each postSlackOpsAlert({...}) call's argument, by matching braces in comment-blanked code. */
function alertArgs(file: string): string[] {
  const code = blankComments(readFileSync(join(process.cwd(), file), "utf8"));
  const out: string[] = [];
  const head = "postSlackOpsAlert({";
  for (let at = code.indexOf(head); at !== -1; at = code.indexOf(head, at + 1)) {
    const start = at + head.length - 1;
    let depth = 0;
    let i = start;
    for (; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) break;
    }
    out.push(code.slice(start, i + 1));
  }
  return out;
}

describe("every refund alert says whether its subject is test data", () => {
  it("found the alerts (floor: 14 in chargeRefunded, 4 in the gift file)", () => {
    expect(alertArgs(FILES[0]).length).toBeGreaterThan(13);
    expect(alertArgs(FILES[1]).length).toBeGreaterThan(3);
  });

  it.each(FILES)("%s: each call carries seed", (file) => {
    const missing = alertArgs(file).filter((a) => !/\bseed:/.test(a));
    expect(missing).toEqual([]);
  });

  it("a call with no seed is seen as missing", () => {
    expect(/\bseed:/.test(`{ kind: "custom", title: "x" }`)).toBe(false);
  });
});

async function run(object: Record<string, unknown>): Promise<void> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  const fn: EdgeHarness = await loadEdgeFunction("stripe-webhook");
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({
    id: "evt_seed_alert",
    type: "charge.refunded",
    data: { object },
  });
  await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
}

type Alert = { title: string; seed?: boolean };
const alerts = () => slackAlerts as Alert[];
const FULL = { id: "ch_s", payment_intent: "pi_s", amount: 7500, amount_refunded: 7500 };
const PARTIAL = { id: "ch_s", payment_intent: "pi_s", amount: 7500, amount_refunded: 100 };
const REVOKED = {
  outcome: "revoked", reason: "refund", credit_id: "gc-1", tree_size: 1,
  revoked_count: 1, revoked_cents: 7500, spent_count: 0, spent_cents: 0, spent_job_ids: [],
};

describe("a refund alert follows its subject", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  /** A refund of a job whose Helpr was already paid: the job's state is left alone and ops is paged. */
  const released = (is_seed: boolean) => ({
    rows: [{ id: "job-1", customer_id: "c", helper_id: "h", title: "T", payment_status: "released", is_seed }],
  });

  it("a seed job's refund alert carries seed: true", async () => {
    scenario.reads.jobs = released(true);
    scenario.reads.gift_cards = { rows: [] };
    await run(FULL);
    const a = alerts().filter((x) => /Full refund on a job in 'released'/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(true);
  });

  it("a real job's refund alert does not", async () => {
    scenario.reads.jobs = released(false);
    scenario.reads.gift_cards = { rows: [] };
    await run(FULL);
    const a = alerts().filter((x) => /Full refund on a job in 'released'/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(false);
  });

  it.each([[true], [false]])("a gift whose donor's is_seed is %s: its revocation alert says the same", async (is_seed) => {
    scenario.rpc.revoke_gift_card_for_refund = REVOKED;
    scenario.reads.jobs = { rows: [] };
    scenario.reads.gift_cards = { rows: [{ donor_id: "d-1" }] };
    scenario.reads.profiles = { rows: [{ is_seed }] };
    await run(FULL);
    const a = alerts().filter((x) => /Gift card charge reversed/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(is_seed);
  });

  it("a failed read of the donor's flag pages as real, never hides the page", async () => {
    scenario.rpc.revoke_gift_card_for_refund = REVOKED;
    scenario.reads.jobs = { rows: [] };
    scenario.reads.gift_cards = { rows: [{ donor_id: "d-1" }] };
    scenario.reads.profiles = { error: { message: "db down" } };
    await run(FULL);
    const a = alerts().filter((x) => /Gift card charge reversed/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(false);
  });

  /** A crew decision is always handed to a person: an admin notice and an alert. */
  const crewDecision = (is_seed: boolean) => {
    scenario.reads.jobs = {
      rows: [{ id: "job-1", customer_id: "c", helper_id: "h", title: "T", payment_status: "refunded", is_seed }],
    };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.disputes = { rows: [{ id: "d-1", execution_status: "crew_fanout" }] };
    scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
  };
  const adminNotices = () => scenario.writes
    .filter((w) => w.table === "notifications" && w.op === "insert")
    .map((w) => w.payload as { user_id?: string })
    .filter((n) => n.user_id === "admin-1");

  it("a seed job's decided dispute reaches no admin's bell, and its alert is flagged", async () => {
    crewDecision(true);
    await run(FULL);
    expect(adminNotices()).toEqual([]);
    const a = alerts().filter((x) => /settle it by hand/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(true);
  });

  it("a real job's decided dispute still notifies the admin and pages", async () => {
    crewDecision(false);
    await run(FULL);
    expect(adminNotices()).toHaveLength(1);
    const a = alerts().filter((x) => /settle it by hand/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(false);
  });

  it.each([[true], [false]])("a partial refund on a job with is_seed %s: its ledger alert says the same", async (is_seed) => {
    stripeMock.refunds.list.mockResolvedValue({
      data: [{ id: "re_1", amount: 100, status: "succeeded", metadata: {} }],
      has_more: false,
    });
    scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "c", is_seed }] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.writeErrors.payment_refunds = { message: "db down" };
    await run(PARTIAL);
    const a = alerts().filter((x) => /Partial refund ledger write failed/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(is_seed);
  });

  it.each([[true], [false]])("a Shops order with is_seed %s refunded by hand: its alert says the same", async (is_seed) => {
    stripeMock.refunds.list.mockResolvedValue({
      data: [{ id: "re_s", amount: 7500, status: "succeeded", metadata: {} }],
      has_more: false,
    });
    scenario.rpc.shop_record_hand_refund = "not_shops";
    scenario.reads.shop_orders = { rows: [{ is_seed }] };
    await run({ ...FULL, metadata: { kind: "shop_order", order_id: "o-1" } });
    const a = alerts().filter((x) => /refunded outside the app/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(is_seed);
  });

  // is_seed false, but the row belongs to a test account: matches 20261030150104 (T12's gap).
  const testSubject = (who: string) => (args: { p_user_id: string }) => args.p_user_id === who;

  it.each([["c"], ["h"]])("is_seed false, test account %s on the job: the alert is flagged, the admin's bell stays quiet", async (who) => {
    crewDecision(false);
    scenario.rpc.is_test_subject = testSubject(who);
    await run(FULL);
    expect(adminNotices()).toEqual([]);
    const a = alerts().filter((x) => /settle it by hand/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(true);
  });

  it("is_test_subject failing pages as real", async () => {
    scenario.reads.jobs = released(false);
    scenario.reads.gift_cards = { rows: [] };
    scenario.rpcErrors = { is_test_subject: { message: "db down" } };
    await run(FULL);
    const a = alerts().filter((x) => /Full refund on a job in 'released'/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(false);
  });

  it("a partial refund on a test account's job is flagged", async () => {
    stripeMock.refunds.list.mockResolvedValue({
      data: [{ id: "re_1", amount: 100, status: "succeeded", metadata: {} }],
      has_more: false,
    });
    scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "c", helper_id: "h", is_seed: false }] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.writeErrors.payment_refunds = { message: "db down" };
    scenario.rpc.is_test_subject = testSubject("h");
    await run(PARTIAL);
    const a = alerts().filter((x) => /Partial refund ledger write failed/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(true);
  });

  it.each([["b"], ["s"]])("a Shops order with is_seed false and test party %s: flagged", async (who) => {
    stripeMock.refunds.list.mockResolvedValue({
      data: [{ id: "re_s", amount: 7500, status: "succeeded", metadata: {} }],
      has_more: false,
    });
    scenario.rpc.shop_record_hand_refund = "not_shops";
    scenario.reads.shop_orders = { rows: [{ is_seed: false, buyer_id: "b", seller_id: "s" }] };
    scenario.rpc.is_test_subject = testSubject(who);
    await run({ ...FULL, metadata: { kind: "shop_order", order_id: "o-1" } });
    const a = alerts().filter((x) => /refunded outside the app/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(true);
  });

  it("a gift whose donor is a test account (is_seed false) is flagged", async () => {
    scenario.rpc.revoke_gift_card_for_refund = REVOKED;
    scenario.reads.jobs = { rows: [] };
    scenario.reads.gift_cards = { rows: [{ donor_id: "d-1" }] };
    scenario.reads.profiles = { rows: [{ is_seed: false }] };
    scenario.rpc.is_test_subject = testSubject("d-1");
    await run(FULL);
    const a = alerts().filter((x) => /Gift card charge reversed/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(true);
  });

  it("a partial refund of a seed donor's gift is flagged too", async () => {
    scenario.reads.jobs = { rows: [] };
    scenario.reads.gift_cards = { rows: [{ id: "gc-1", amount: 75, status: "active", payment_status: "paid", donor_id: "d-1" }] };
    scenario.reads.profiles = { rows: [{ is_seed: true }] };
    await run(PARTIAL);
    const a = alerts().filter((x) => /PARTIALLY refunded/.test(x.title));
    expect(a).toHaveLength(1);
    expect(a[0].seed).toBe(true);
  });
});
