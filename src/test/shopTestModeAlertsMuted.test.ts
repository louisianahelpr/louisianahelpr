/**
 * Owner rule 11-04 ("test data never shows to the owner") supersedes the Shops seed-policy notes of 10-17 (shopHolds)
 * and 10-19 (shopRefunds) for TEST-mode Stripe money: a captured payment on an ended order, or a refund Stripe kept
 * refusing, on a TEST-mode payment (pi.livemode === false / row.livemode === false) is muted the way stripe-webhook's
 * inStripeTestMode() scope mutes a test-mode event (postSlackOpsAlert logs it as test: no Slack, ledger or digest
 * row). A LIVE one pages exactly as before (the floor). The money handling itself is unchanged.
 *
 * @mutate supabase/functions/_shared/shopHolds.ts |         stripeTestMode: pi.livemode === false,\n |
 * @mutate supabase/functions/_shared/shopRefunds.ts |       stripeTestMode: row.livemode === false,\n |
 * @mutate supabase/functions/_shared/slack-alerts.ts |     if (inStripeTestMode() \|\| input.stripeTestMode === true) { |     if (inStripeTestMode()) {
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { blankComments } from "./helpers/blankNonCode";

const alerts = vi.hoisted(() => [] as Array<{ title: string; stripeTestMode?: boolean }>);
vi.mock("../../supabase/functions/_shared/slack-alerts.ts", () => ({
  postSlackOpsAlert: async (input: { title: string; stripeTestMode?: boolean }) => { alerts.push(input); return true; },
}));

// Loaded by a computed path: these Deno modules import slack-alerts (Deno.env), so the app tsconfig cannot list them;
// vitest runs them as-is with slack-alerts mocked above.
type Fn = (...a: unknown[]) => Promise<string>;
const shared = (name: string) => `../../supabase/functions/_shared/${name}.ts`;
const { releaseShopHold } = (await import(/* @vite-ignore */ shared("shopHolds"))) as { releaseShopHold: Fn };
const { sendShopRefund } = (await import(/* @vite-ignore */ shared("shopRefunds"))) as { sendShopRefund: Fn };

const db = { rpc: vi.fn(async () => ({ data: null, error: null })) };
const holdRow = { order_id: "o1", payment_intent_id: "pi_1", livemode: null, checkout_session_id: null } as never;
const refundRow = (livemode: boolean) =>
  ({ refund_id: "r1", order_id: "o1", payment_intent_id: "pi_1", refund_cents: 500, livemode, checkout_session_id: null, attempts: 11 }) as never;

beforeEach(() => {
  alerts.length = 0;
  db.rpc.mockClear();
});

describe("a captured payment on an ended Shops order", () => {
  const stripe = (livemode: boolean) => ({ paymentIntents: { retrieve: async () => ({ id: "pi_1", status: "succeeded", livemode }) } }) as never;

  it("TEST mode: the page is marked test (muted), and the order still waits for its refund", async () => {
    expect(await releaseShopHold(stripe(false), db, holdRow)).toBe("captured_needs_refund");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].stripeTestMode).toBe(true);
  });

  it("LIVE mode: pages as before (the floor)", async () => {
    expect(await releaseShopHold(stripe(true), db, holdRow)).toBe("captured_needs_refund");
    expect(alerts.map((a) => [a.title, a.stripeTestMode === true])).toEqual([["Shops: a closed order's payment was captured", false]]);
  });
});

describe("a Shops refund Stripe kept refusing", () => {
  const stripe = { refunds: { list: async () => ({ data: [] }), create: async () => { throw new Error("card_declined"); } } } as never;

  it("TEST mode: the give-up page is marked test (muted)", async () => {
    expect(await sendShopRefund(stripe, db, refundRow(false))).toBe("failed");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].stripeTestMode).toBe(true);
  });

  it("LIVE mode: pages as before (the floor)", async () => {
    expect(await sendShopRefund(stripe, db, refundRow(true))).toBe("failed");
    expect(alerts.map((a) => [a.title, a.stripeTestMode === true])).toEqual([["Shops: a buyer's refund gave up", false]]);
  });
});

describe("postSlackOpsAlert mutes a stripeTestMode alert like a test-mode event, before seed rows, the ledger or Slack", () => {
  it("the mute check reads input.stripeTestMode", () => {
    const src = blankComments(readFileSync("supabase/functions/_shared/slack-alerts.ts", "utf8"));
    const fn = src.slice(src.indexOf("export async function postSlackOpsAlert("));
    const mute = fn.indexOf("if (inStripeTestMode() || input.stripeTestMode === true) {");
    expect(mute).toBeGreaterThan(0);
    for (const later of ["if (input.seed)", "recordOpsAlertLedger("]) expect(fn.indexOf(later), later).toBeGreaterThan(mute);
  });
});
