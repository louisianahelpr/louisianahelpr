/**
 * Audit 1c D3-5 (Declutter Helpr delivery on prod, 2026-10-29): the delivery step notices ("A Helpr took your
 * delivery", "Your item is on its way", "Your delivery is on hold", the seller's "The Helpr couldn't pick up", the
 * Helpr's "Delivery done") named no item, so a buyer with two deliveries could not tell which one moved; and every
 * buyer notice linked the retired /declutter?view=cart (the Helpr's, ?view=deliver). Fixed in
 * 20261030031642_helpr_delivery_notices_name_the_item (backend proof:
 * src/test/pglite/helprDeliveryNoticesNameTheItem.pglite.mjs, 59 PASS; NEW_MIGRATION=skip 30 FAIL).
 *
 * THE CLASS, read from the EFFECTIVE definition of every SQL function (helpers/effectiveFunctionDefs):
 *   1. every notice the delivery step functions send names its item (declutter_order_items_named or the task title);
 *   2. no function links a retired Declutter address (?view=cart, ?view=deliver) beyond the exact list below, which
 *      only shrinks (a function fixed later must leave the list in the same commit; a new one may never join it).
 *
 * @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql | format('The Helpr couldn''t pick up %s from the seller. Louisiana Helpr will look at it and decide; you''ll be told.',\n             public.declutter_order_items_named(o.id)), | 'The Helpr couldn''t pick up your item from the seller. Louisiana Helpr will look at it and decide; you''ll be told.',
 * @mutate supabase/migrations/20261031231150_helpr_delivery_cant_finish.sql | 'FM999990.00')) END,\n    '/declutter?tab=deliver', t.customer_id); | 'FM999990.00')) END,\n    '/declutter?view=deliver', t.customer_id);
 * @mutate supabase/migrations/20261031170803_declutter_no_helpr_notice_offers_refund.sql | 'Your Helpr can''t make it. The delivery of %s is back up for another Helpr.', public.declutter_order_items_named(o.id)),\n      '/declutter?tab=buying', NULL); | 'Your Helpr can''t make it. The delivery of %s is back up for another Helpr.', public.declutter_order_items_named(o.id)),\n      '/declutter?view=cart', NULL);
 */
import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { effectiveDefs } from "./helpers/effectiveFunctionDefs";
import { blankSqlComments } from "./helpers/blankNonCode";

const DEFS = effectiveDefs(resolve(__dirname, "../../supabase/migrations"));

/** The top-level arguments of the call whose "(" is at `open` (quotes and nested calls respected). */
function callArgs(code: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let cur = "";
  for (let i = open + 1; i < code.length; i++) {
    const c = code[i];
    if (c === "'") {
      let j = i + 1;
      while (j < code.length && !(code[j] === "'" && code[j + 1] !== "'")) j += code[j] === "'" ? 2 : 1;
      cur += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") {
      if (depth === 0) { args.push(cur.trim()); return args; }
      depth--;
    }
    if (c === "," && depth === 0) { args.push(cur.trim()); cur = ""; continue; }
    cur += c;
  }
  return args;
}

function notices(fn: string) {
  const def = DEFS.get(fn);
  if (!def) throw new Error(`no effective definition of ${fn}`);
  const code = blankSqlComments(def.stmt);
  return [...code.matchAll(/declutter_notify(?:_strict)?\s*\(/g)].map((m) => {
    const a = callArgs(code, (m.index ?? 0) + m[0].length - 1);
    return { fn, to: a[0], title: a[2], message: a[3], link: a[4] };
  });
}

/** The functions still linking a retired address on main today (exact; it only shrinks). */
// @two-way src/test/helprDeliveryNoticesNameTheItem.test.ts:expect(now.sort()).toEqual(KNOWN_OLD_LINKS);
const KNOWN_OLD_LINKS = [
  "declutter_add_handover", "declutter_admin_decide_problem", "declutter_answer_refund",
  "declutter_checkout_free", "declutter_close_paid_order", "declutter_complete_handover", "declutter_delivery_raise_paid",
  "declutter_delivery_raises_on_task_close", "declutter_hand_refund_failed", "declutter_handover_sweep", "declutter_mark_order_paid",
  "declutter_pickup_reminder_sweep", "declutter_record_hand_refund", "declutter_refund_after_handover", "declutter_refund_gave_up_check",
  "declutter_refund_paid_order", "declutter_refund_request_to_admin", "declutter_report_no_show", "declutter_seller_cancel_sale",
  "declutter_seller_delivered", "declutter_seller_delivery_on_order", "declutter_setup_fee_refunded", "declutter_take_item",
  "helpr_task_offer_online", "helpr_task_tip_paid", "helpr_task_tip_payout_sent",
].sort();

describe("Helpr delivery notices name the item and open the right tab (audit 1c D3-5)", () => {
  it("every notice the delivery step functions send names its item and links ?tab=, never a retired address", () => {
    const all = [...notices("declutter_delivery_on_task_event"), ...notices("helpr_task_confirm")];
    expect(all.length).toBeGreaterThan(12);
    const unnamed = all.filter((n) => !/declutter_order_items_named\s*\(\s*o\.id\s*\)|\bt\.title\b/.test(n.message ?? "")).map((n) => `${n.fn}: ${n.title}`);
    expect(unnamed, "notices that name no item").toEqual([]);
    const oldLinks = all.filter((n) => !/^'\/declutter\?tab=(buying|selling|deliver)'$/.test(n.link ?? "")).map((n) => `${n.fn}: ${n.title} -> ${n.link}`);
    expect(oldLinks, "notices not opening the recipient's tab").toEqual([]);
  });

  it("no other function links ?view=cart or ?view=deliver beyond the exact known list (it only shrinks)", () => {
    const now: string[] = [];
    for (const [fn, def] of DEFS) {
      // declutter_notice_type READS links (it files a Helpr's ?view=deliver and ?tab=deliver notices as work); it writes none.
      if (fn === "declutter_notice_type") continue;
      if (/'\/declutter\?view=(cart|deliver)\b/.test(blankSqlComments(def.stmt))) now.push(fn);
    }
    expect(DEFS.size).toBeGreaterThan(500);
    expect(now.sort()).toEqual(KNOWN_OLD_LINKS);
  });
});
