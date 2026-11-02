/**
 * Every ?view=cart notice goes to the buyer, so the writer may store it as ?tab=buying (Q2489; migration 20261030155159).
 *
 * The writer (declutter_notify_strict -> declutter_notice_link) rewrites ?view=cart without knowing who the recipient is.
 * That is right only while every sender's recipient is the buyer: measured true on prod on 2026-10-30, and held here for
 * the NEWEST definition of every function, exactly and both ways. A new ?view=cart sender, or one aimed at a seller,
 * fails this test instead of quietly opening the wrong tab. Backend proof with real senders through the real writer:
 * src/test/pglite/declutterCartLinksOpenBuying.pglite.mjs (3x; red without the migration and on its planted defects).
 */
// @mutate supabase/migrations/20261030155159_declutter_cart_links_open_buying.sql | WHEN p_link ~ '^/declutter\?view=cart(&\|#\|$)' | WHEN false
// @mutate supabase/migrations/20261031181404_declutter_notices_name_the_item_sweep_remind_task.sql | 'link', public.declutter_notice_link(p_link)) | 'link', p_link)
// @mutate supabase/migrations/20261026154738_declutter_setup_fee_once.sql | PERFORM public.declutter_notify(o.buyer_id, 'payment', 'Setup fee coming back', | PERFORM public.declutter_notify(o.seller_id, 'payment', 'Setup fee coming back',
// @mutate supabase/functions/declutter-money/index.ts | const link = `${getAppUrl()}/declutter?tab=buying`; | const link = `${getAppUrl()}/declutter?view=cart`;
// @mutate supabase/functions/stripe-webhook/handlers/declutterCheckout.ts | path: "/declutter?tab=buying", actionLabel: "Open Buying", | path: "/declutter?view=cart", actionLabel: "Open Buying",
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

/** The recipient of each ?view=cart notice in each function's newest definition. */
const CART_SENDERS: Record<string, string> = {
  declutter_add_handover: "r.buyer_id",
  declutter_admin_decide_problem: "o.buyer_id",
  declutter_answer_refund: "o.buyer_id",
  declutter_checkout_free: "v_uid",
  declutter_close_paid_order: "o.buyer_id",
  declutter_complete_handover: "o.buyer_id",
  declutter_delivery_raise_paid: "o.buyer_id",
  declutter_delivery_raises_on_task_close: "v_buyer",
  declutter_hand_refund_failed: "v_buyer",
  declutter_handover_sweep: "r.buyer_id",
  declutter_mark_order_paid: "o.buyer_id",
  declutter_pick_free_request: "v_req.requester_id",
  declutter_pickup_reminder_sweep: "r.buyer_id",
  declutter_record_hand_refund: "v_buyer",
  declutter_refund_after_handover: "o.buyer_id",
  declutter_refund_gave_up_check: "r.buyer_id",
  declutter_refund_paid_order: "o.buyer_id",
  declutter_refund_request_to_admin: "o.buyer_id",
  declutter_report_no_show: "o.buyer_id",
  declutter_seller_cancel_sale: "v_line.buyer_id",
  declutter_seller_delivered: "o.buyer_id",
  declutter_seller_delivery_on_order: "NEW.buyer_id",
  declutter_setup_fee_refunded: "o.buyer_id",
  declutter_take_item: "p_buyer",
};
/** v_uid is the buyer in declutter_checkout_free: the member claiming the free item. */
const BUYER_VALUE = /^((o|r|d|v_line|NEW)\.buyer_id|v_buyer|p_buyer)$/;
const CALLER_IS_BUYER: Record<string, true> = { declutter_checkout_free: true };
/** The picked asker IS the buyer of the $0 free order declutter_pick_free_request makes for them (20261101181129). */
const REQUESTER_IS_BUYER: Record<string, true> = { declutter_pick_free_request: true };

function cartRecipients(): Record<string, string> {
  const out: Record<string, string[]> = {};
  for (const [name, def] of effectiveDefs("supabase/migrations")) {
    const body = blankSqlComments(def.stmt);
    for (const m of body.matchAll(/\/declutter\?view=cart/g)) {
      // The nearest notice call before the link, past any helper called inside its message. A message can hold a
      // semicolon, so the statement is bounded by the next PERFORM, not by ";".
      const before = body.slice(0, m.index);
      const head = [...before.matchAll(/public\.declutter_(?:notify_strict|notify|pickup_remind)\(\s*([^,]+),/g)].pop();
      const sameStatement = head && !/\bPERFORM\b/.test(before.slice(head.index));
      (out[name] ??= []).push(sameStatement ? head[1].trim() : "<not a notice call>");
    }
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...new Set(v)].sort().join(",")]));
}

describe("every ?view=cart notice goes to the buyer", () => {
  const found = cartRecipients();
  it("reads the senders", () => {
    expect(Object.keys(found).length).toBeGreaterThan(20);
  });
  it("the list is exact, both ways", () => {
    expect(found).toEqual(CART_SENDERS);
  });
  it("every recipient is the buyer", () => {
    for (const [fn, who] of Object.entries(found)) {
      for (const r of who.split(",")) {
        expect(BUYER_VALUE.test(r) || (r === "v_uid" && CALLER_IS_BUYER[fn]) || (r === "v_req.requester_id" && REQUESTER_IS_BUYER[fn]), `${fn} sends ?view=cart to ${r}`).toBe(true);
      }
    }
  });
  it("no ?view=offers notice is left", () => {
    const left = [...effectiveDefs("supabase/migrations")].filter(([, d]) => /\/declutter\?view=offers/.test(blankSqlComments(d.stmt))).map(([n]) => n);
    expect(left).toEqual([]);
  });
  it("the writer rewrites it", () => {
    const helper = blankSqlComments(effectiveDefs("supabase/migrations").get("declutter_notice_link")?.stmt ?? "");
    expect(helper).toContain("WHEN p_link ~ '^/declutter\\?view=cart(&|#|$)'");
    expect(helper).toContain("regexp_replace(p_link, '^/declutter\\?view=cart', '/declutter?tab=buying')");
    const remind = blankSqlComments(effectiveDefs("supabase/migrations").get("declutter_pickup_remind")?.stmt ?? "");
    expect(remind).toContain("'link', public.declutter_notice_link(p_link))");
  });
  it.each(["supabase/functions/declutter-money/index.ts", "supabase/functions/stripe-webhook/handlers/declutterCheckout.ts"])(
    "the money email in %s opens the buyer's tab", (file) => {
      const src = readFileSync(file, "utf8");
      // AUD31-35: declutterCheckout passes the path to the branded email as a plain string.
      expect(src).toMatch(/\/declutter\?tab=buying[`"]/);
      expect(src).not.toContain("const link = `${getAppUrl()}/declutter?view=cart`");
    });
});
